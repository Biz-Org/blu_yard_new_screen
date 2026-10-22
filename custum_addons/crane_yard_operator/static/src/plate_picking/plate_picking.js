/** @odoo-module **/

import { Component, onWillUnmount, reactive, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { CraneYardNav } from "@crane_yard_operator/crane_nav/crane_nav";

const TRAVEL_MS = 700;
const HOOK_MS = 400;
/** Cache-bust so Odoo rebuilds assets after conveyor/green/SO update. */
const PLATE_UI_REV = "crane-pos-restore-20261017";

// Horizontal position (%) of the crane trolley above each yard column.
const CRANE_POSITIONS = { home: 50, A: 16.666, B: 50, C: 83.333 };
// Move / Return screens: Stack A left, Stack B right (two equal columns).
const TWO_COL_CRANE_POSITIONS = { home: 50, A: 25, B: 75 };
const MOVE_CRANE_POSITIONS = TWO_COL_CRANE_POSITIONS;
const MOVE_STEP_COUNT = 3;

const LOCATION_NAMES = { A: "Stack A", B: "Stack B", C: "Conveyor Belt" };

const STEPS = [
    { id: 1, label: "Identify" },
    { id: 2, label: "Mark Green" },
    { id: 3, label: "Move Upper Plates" },
    { id: 4, label: "Pick" },
    { id: 5, label: "Drop to Conveyor" },
    { id: 6, label: "Completed" },
];

const RESTORE_STEPS = [
    { id: 1, label: "Temp Stack" },
    { id: 2, label: "Return to Original" },
    { id: 3, label: "Completed" },
];

/**
 * Plate yard demo data with SO / SR numbers from the picking list.
 * Required plates (green) share SO where they belong to the same order.
 * Stack A is bottom → top; pick order follows SR among free top plates.
 */
function demoYard() {
    const plates = [
        { id: "PL-001", srNumber: "SR-001", soNumber: "SO-1001", size: "6000 x 2000 mm", thickness: 12, required: true },
        { id: "PL-002", srNumber: "SR-002", soNumber: "SO-1001", size: "6000 x 2000 mm", thickness: 12, required: true },
        { id: "PL-003", srNumber: "SR-003", soNumber: "SO-1002", size: "6000 x 2000 mm", thickness: 10, required: true },
        { id: "PL-004", srNumber: "SR-004", soNumber: "SO-1003", size: "8000 x 2500 mm", thickness: 16 },
        { id: "PL-005", srNumber: "SR-005", soNumber: "SO-1003", size: "8000 x 2500 mm", thickness: 20 },
        { id: "PL-101", srNumber: "SR-101", soNumber: "SO-1004", size: "6000 x 1500 mm", thickness: 8 },
        { id: "PL-102", srNumber: "SR-102", soNumber: "SO-1004", size: "6000 x 1500 mm", thickness: 8 },
        { id: "PL-103", srNumber: "SR-103", soNumber: "SO-1005", size: "10000 x 2500 mm", thickness: 25 },
    ];
    return {
        plates: Object.fromEntries(
            plates.map((p) => [
                p.id,
                { required: false, movedFrom: null, homeStack: null, homeIndex: null, ...p },
            ])
        ),
        // Each stack is ordered bottom -> top. C = Conveyor Belt (horizontal drop zone).
        stacks: {
            A: ["PL-001", "PL-002", "PL-003", "PL-004", "PL-005"],
            B: ["PL-101", "PL-102", "PL-103"],
            C: [],
        },
        selectedId: null,
        landedId: null,
        busy: false,
        restoreComplete: false,
        crane: { pos: "home", load: null, phase: "idle" },
    };
}

// Shared by all plate screens so progress made on one is visible on the others.
const yard = reactive(demoYard());

const MOVE_ACTION = "crane_yard_operator.action_move_plates";
const DROP_ACTION = "crane_yard_operator.action_drop_truck";
const RESTORE_ACTION = "crane_yard_operator.action_return_plates";

export class PlatePicking extends Component {
    static template = "crane_yard_operator.PlatePicking";
    static components = { CraneYardNav };
    static props = ["*"];
    static mode = "move";

    setup() {
        this.state = useState(yard);
        this.actionService = useService("action");
        this.alive = true;
        // Two-column screens cannot use Conveyor (C) crane slots — snap into A/B space.
        if ((this.isMoveScreen || this.isRestoreScreen) && !["A", "B", "home"].includes(this.state.crane.pos)) {
            this.state.crane.pos = this.isRestoreScreen ? "B" : "home";
        }
        onWillUnmount(() => {
            this.alive = false;
        });
    }

    // ------------------------------------------------------------------
    // Derived data
    // ------------------------------------------------------------------

    get mode() {
        return this.constructor.mode;
    }

    get isMoveScreen() {
        return this.mode === "move";
    }

    get isRestoreScreen() {
        return this.mode === "restore";
    }

    get isDropScreen() {
        return this.mode === "drop";
    }

    get navKey() {
        if (this.isMoveScreen) {
            return "move_plates";
        }
        if (this.isRestoreScreen) {
            return "return_plates";
        }
        return "drop_truck";
    }

    get screenTitle() {
        if (this.isMoveScreen) {
            return "Move Upper Plates";
        }
        if (this.isRestoreScreen) {
            return "Return Temporary Plates";
        }
        return "Drop Green Plates to Conveyor";
    }

    get movedCount() {
        return Object.values(this.state.plates).filter((p) => p.movedFrom).length;
    }

    /** Plates currently on Stack B that were temporarily moved from their original stack. */
    get temporaryPlateIds() {
        return this.state.stacks.B.filter((id) => {
            const plate = this.state.plates[id];
            return Boolean(plate.movedFrom) && !plate.required;
        });
    }

    /**
     * Next plate safe to return: top of Stack B must be a temporary plate,
     * and returning it must not cover remaining green picks still in Stack A.
     */
    get nextReturnId() {
        const stackB = this.state.stacks.B;
        if (!stackB.length) {
            return null;
        }
        const topId = stackB[stackB.length - 1];
        const plate = this.state.plates[topId];
        if (!plate.movedFrom || plate.required) {
            return null;
        }
        // After all required plates are on the conveyor, always allow return.
        if (this.remainingCount === 0) {
            return topId;
        }
        // Do not put a temp plate back on top of remaining green picks.
        const topA = this.state.stacks.A[this.state.stacks.A.length - 1];
        if (topA && this.state.plates[topA].required) {
            return null;
        }
        return topId;
    }

    get allTemporaryReturned() {
        return this.temporaryPlateIds.length === 0 && this.state.restoreComplete;
    }

    get totalRequired() {
        return Object.values(this.state.plates).filter((p) => p.required).length;
    }

    get completedCount() {
        return this.state.stacks.C.length;
    }

    get remainingCount() {
        return this.totalRequired - this.completedCount;
    }

    get progressPercent() {
        return this.totalRequired ? Math.round((this.completedCount / this.totalRequired) * 100) : 0;
    }

    /** Required plates sorted by SR for the pick list / sidebar. */
    get pickListBySr() {
        return Object.values(this.state.plates)
            .filter((p) => p.required)
            .sort((a, b) => String(a.srNumber).localeCompare(String(b.srNumber)))
            .map((plate) => ({
                id: plate.id,
                srNumber: plate.srNumber,
                soNumber: plate.soNumber,
                thickness: plate.thickness,
                status: this.plateStatus(plate.id),
                label: this.plateStatusLabel(plate.id),
            }));
    }

    /** Non-required plates lying above the highest required plate in Stack A. */
    get blockerIds() {
        const stackA = this.state.stacks.A;
        let lastRequired = -1;
        stackA.forEach((id, index) => {
            if (this.state.plates[id].required) {
                lastRequired = index;
            }
        });
        return lastRequired === -1 ? [] : stackA.slice(lastRequired + 1);
    }

    get nextPickId() {
        const stackA = this.state.stacks.A;
        const top = stackA[stackA.length - 1];
        return top && this.state.plates[top].required && !this.blockerIds.length ? top : null;
    }

    get loadIsRequired() {
        const load = this.state.crane.load;
        return Boolean(load && this.state.plates[load].required);
    }

    get currentStep() {
        const { load } = this.state.crane;
        if (!load && this.completedCount === this.totalRequired) {
            return 6;
        }
        if (this.loadIsRequired) {
            return 5;
        }
        if (load || this.blockerIds.length) {
            return 3;
        }
        return 4;
    }

    get restoreStep() {
        if (this.state.crane.load && this.state.plates[this.state.crane.load]?.movedFrom) {
            return 2;
        }
        if (this.temporaryPlateIds.length) {
            return this.nextReturnId ? 2 : 1;
        }
        if (this.state.restoreComplete) {
            return 3;
        }
        return 1;
    }

    get steps() {
        if (this.isRestoreScreen) {
            const current = this.restoreStep;
            return RESTORE_STEPS.map((step) => ({
                ...step,
                state:
                    step.id < current || (current === 3 && step.id === 3)
                        ? "done"
                        : step.id === current
                        ? "active"
                        : "todo",
            }));
        }
        const current = this.currentStep;
        const steps = this.isMoveScreen ? STEPS.slice(0, MOVE_STEP_COUNT) : STEPS;
        return steps.map((step) => ({
            ...step,
            state:
                step.id < current || (current === 6 && step.id === 6)
                    ? "done"
                    : step.id === current
                    ? "active"
                    : "todo",
        }));
    }

    get stackColumns() {
        if (this.isRestoreScreen) {
            const pendingReturn =
                this.temporaryPlateIds.length +
                (this.state.crane.load && this.state.plates[this.state.crane.load]?.movedFrom ? 1 : 0);
            // Same column order as Move Upper Plates: Stack A left, Stack B right.
            return [
                {
                    key: "A",
                    name: "Stack A",
                    role: "Original",
                    roleClass: "source",
                    ghosts: [...Array(Math.min(pendingReturn, 3)).keys()],
                },
                {
                    key: "B",
                    name: "Stack B",
                    role: "Temporary",
                    roleClass: "temporary",
                    ghosts: [],
                },
            ];
        }
        const pendingForB =
            this.blockerIds.length + (this.state.crane.load && !this.loadIsRequired ? 1 : 0);
        return [
            { key: "A", name: "Stack A", role: "Source", roleClass: "source", ghosts: [] },
            {
                key: "B",
                name: "Stack B",
                role: "Temporary",
                roleClass: "temporary",
                ghosts: [...Array(pendingForB).keys()],
            },
        ];
    }

    get conveyorGhosts() {
        return [...Array(this.remainingCount).keys()];
    }

    get conveyorPlates() {
        return this.state.stacks.C.map((id) => this.state.plates[id]);
    }

    get cranePosition() {
        const twoCol = this.isMoveScreen || this.isRestoreScreen;
        const positions = twoCol ? TWO_COL_CRANE_POSITIONS : CRANE_POSITIONS;
        const pos = this.state.crane.pos;
        if (Object.prototype.hasOwnProperty.call(positions, pos)) {
            return positions[pos];
        }
        // Coming from Drop (3-col): map Conveyor slot onto Stack B so the trolley
        // does not jump to the middle when the layout switches to two columns.
        if (twoCol && pos === "C") {
            return positions.B;
        }
        return positions.home;
    }

    /** Crane stack keys valid for the current yard layout. */
    normalizeCranePos(pos) {
        if (this.isMoveScreen || this.isRestoreScreen) {
            if (pos === "A" || pos === "B" || pos === "home") {
                return pos;
            }
            return pos === "C" ? "B" : "home";
        }
        if (pos === "A" || pos === "B" || pos === "C" || pos === "home") {
            return pos;
        }
        return "home";
    }

    /** Plates grouped by stack, listed top -> bottom, for the sidebar. */
    get plateGroups() {
        const order = this.isRestoreScreen || this.isMoveScreen ? ["A", "B"] : ["A", "B", "C"];
        return order.map((key) => ({
            key,
            name: LOCATION_NAMES[key],
            plates: [...this.state.stacks[key]].reverse().map((id) => {
                const plate = this.state.plates[id];
                return {
                    id,
                    srNumber: plate.srNumber,
                    soNumber: plate.soNumber,
                    thickness: plate.thickness,
                    status: this.plateStatus(id),
                    label: this.plateStatusLabel(id),
                    homeLabel: plate.homeStack
                        ? `Home: Stack ${plate.homeStack}`
                        : plate.movedFrom
                        ? `From Stack ${plate.movedFrom}`
                        : "",
                };
            }),
        }));
    }

    get craneStatus() {
        const { phase, load } = this.state.crane;
        if (this.isRestoreScreen) {
            switch (phase) {
                case "moving":
                    return {
                        title: "Moving",
                        text: load ? `Returning ${load} to Stack A` : "Travelling",
                        tone: "primary",
                    };
                case "lifting":
                    return { title: "Picking", text: `Lifting ${load} from Stack B`, tone: "primary" };
                case "dropping":
                    return { title: "Placing", text: `${load} onto original stack`, tone: "green" };
            }
            if (this.restoreStep === 3) {
                return { title: "Done", text: "Temporary plates returned", tone: "green" };
            }
            return { title: "Ready", text: "Return plates from Stack B", tone: "muted" };
        }
        switch (phase) {
            case "moving":
                return {
                    title: "Moving",
                    text: load
                        ? `Carrying ${load} to ${this.loadIsRequired ? "Conveyor" : "Stack B"}`
                        : "Travelling",
                    tone: "primary",
                };
            case "lifting":
                return { title: "Picking", text: `Lifting ${load}`, tone: "green" };
            case "dropping":
                return { title: "Dropping", text: `${load} to Conveyor`, tone: "green" };
        }
        if (this.currentStep === 6) {
            return { title: "Done", text: "All plates on conveyor", tone: "green" };
        }
        return { title: "Ready", text: "Waiting for operator", tone: "muted" };
    }

    get nextAction() {
        if (this.isRestoreScreen) {
            const temps = this.temporaryPlateIds.length;
            if (this.restoreStep === 3) {
                return {
                    tone: "green",
                    icon: "fa-check-circle",
                    title: "Temporary plates returned",
                    text: "All temporarily moved plates are back on their original stack in the correct order.",
                };
            }
            if (!temps) {
                return {
                    tone: "primary",
                    icon: "fa-info-circle",
                    title: "No temporary plates",
                    text: "Move upper plates to Stack B first, then return them here after picking is done.",
                };
            }
            if (!this.nextReturnId) {
                return {
                    tone: "primary",
                    icon: "fa-hand-paper-o",
                    title: "Finish green picks first",
                    text: "Returning plates now would cover remaining green plates. Complete Drop to Conveyor, then return.",
                };
            }
            const next = this.state.plates[this.nextReturnId];
            return {
                tone: "primary",
                icon: "fa-reply",
                title: `Return ${next.id} to Stack ${next.homeStack || next.movedFrom || "A"}`,
                text: `${temps} temporary plate${temps > 1 ? "s" : ""} on Stack B. Return ${temps > 1 ? "them" : "it"} to the original stack without changing order.`,
            };
        }
        const blockers = this.blockerIds.length;
        if (this.isMoveScreen && this.currentStep !== 3) {
            return {
                tone: "green",
                icon: "fa-check-circle",
                title: "Upper plates moved",
                text: "The green plates are free. Continue on the Drop to Conveyor screen.",
            };
        }
        switch (this.currentStep) {
            case 3:
                if (!this.isMoveScreen) {
                    return {
                        tone: "primary",
                        icon: "fa-exchange",
                        title: "Move upper plates first",
                        text: `${blockers} plate${blockers > 1 ? "s are" : " is"} still on top of the green plates. Clear ${blockers > 1 ? "them" : "it"} on the Move Upper Plates screen.`,
                    };
                }
                return {
                    tone: "primary",
                    icon: "fa-exchange",
                    title: "Move upper plates to Stack B",
                    text: blockers
                        ? `${blockers} plate${blockers > 1 ? "s are" : " is"} on top of the green plates. Move ${blockers > 1 ? "them" : "it"} to Stack B first.`
                        : "Placing plate on Stack B…",
                };
            case 4: {
                const next = this.nextPickId && this.state.plates[this.nextPickId];
                return {
                    tone: "green",
                    icon: "fa-hand-paper-o",
                    title: next ? `Pick ${next.id} (${next.srNumber})` : "Pick green plate",
                    text: next
                        ? `Pick ${next.srNumber} / ${next.soNumber} from Stack A and drop it onto the Conveyor Belt.`
                        : "Pick the green plate from Stack A and drop it onto the Conveyor Belt.",
                };
            }
            case 5: {
                const load = this.state.crane.load && this.state.plates[this.state.crane.load];
                return {
                    tone: "green",
                    icon: "fa-ellipsis-h",
                    title: load ? `Drop ${load.id}` : "Drop to Conveyor",
                    text: load
                        ? `Crane is carrying ${load.srNumber} (${load.soNumber}) to the Conveyor Belt.`
                        : "Crane is carrying the plate to the Conveyor Belt.",
                };
            }
            default:
                if (this.temporaryPlateIds.length) {
                    return {
                        tone: "primary",
                        icon: "fa-reply",
                        title: "Return temporary plates",
                        text: `${this.temporaryPlateIds.length} plate${this.temporaryPlateIds.length > 1 ? "s are" : " is"} still on Stack B. Open Return Temporary Plates to restore the original stack.`,
                    };
                }
                return {
                    tone: "green",
                    icon: "fa-check-circle",
                    title: "All plates on conveyor",
                    text: `${this.completedCount} / ${this.totalRequired} plates are on the Conveyor Belt.`,
                };
        }
    }

    get selectedPlate() {
        const id = this.state.selectedId;
        if (!id) {
            return null;
        }
        const plate = this.state.plates[id];
        return {
            ...plate,
            location: this.plateLocation(id),
            status: this.plateStatusLabel(id),
        };
    }

    // ------------------------------------------------------------------
    // Plate helpers
    // ------------------------------------------------------------------

    plateLocation(id) {
        for (const key of Object.keys(this.state.stacks)) {
            if (this.state.stacks[key].includes(id)) {
                return LOCATION_NAMES[key];
            }
        }
        return "Crane Hook";
    }

    plateStatus(id) {
        const plate = this.state.plates[id];
        if (this.state.crane.load === id) {
            return "moving";
        }
        if (plate.required) {
            return this.state.stacks.C.includes(id) ? "done" : "pick";
        }
        if (this.blockerIds.includes(id)) {
            return "relocate";
        }
        return plate.movedFrom ? "relocated" : "normal";
    }

    plateStatusLabel(id) {
        switch (this.plateStatus(id)) {
            case "done":
                return "On Conveyor";
            case "moving":
                return "On Crane Hook";
            case "pick":
                return id === this.nextPickId ? "Ready to Pick" : "Waiting (plates on top)";
            case "relocate":
                return "Move to Stack B first";
            case "relocated":
                return this.isRestoreScreen ? "Return to original stack" : "Moved to Stack B";
            default:
                return "In Stack";
        }
    }

    plateClass(id) {
        const status = this.plateStatus(id);
        const plate = this.state.plates[id];
        const classes = ["o_cy_plate"];
        if (status === "done") {
            classes.push("o_cy_plate--done");
        } else if (plate.required) {
            classes.push("o_cy_plate--pick");
        }
        if (status === "relocate") {
            classes.push("o_cy_plate--relocate");
        }
        if (id === this.nextPickId && !this.state.busy) {
            classes.push("is-next");
        }
        if (id === this.state.selectedId) {
            classes.push("is-selected");
        }
        if (id === this.state.landedId) {
            classes.push("is-landed");
        }
        return classes.join(" ");
    }

    plateTooltip(id) {
        const plate = this.state.plates[id];
        return [
            `Plate ID: ${plate.id}`,
            `SR Number: ${plate.srNumber || "—"}`,
            `Sales Order: ${plate.soNumber || "—"}`,
            `Size: ${plate.size}`,
            `Thickness: ${plate.thickness} mm`,
            `Location: ${this.plateLocation(id)}`,
            `Status: ${this.plateStatusLabel(id)}`,
        ].join("\n");
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    selectPlate(id) {
        this.state.selectedId = this.state.selectedId === id ? null : id;
    }

    async moveUpperPlates() {
        if (this.state.busy || !this.blockerIds.length) {
            return;
        }
        this.state.busy = true;
        this.state.restoreComplete = false;
        try {
            while (this.alive && this.blockerIds.length) {
                const stackA = this.state.stacks.A;
                await this.transfer(stackA[stackA.length - 1], "A", "B");
            }
        } finally {
            this.state.busy = false;
        }
    }

    pickAndDrop() {
        return this.pickPlate(this.nextPickId);
    }

    async pickPlate(id) {
        if (this.state.busy || !id || id !== this.nextPickId) {
            return;
        }
        if (!this.state.plates[id]?.required) {
            return;
        }
        this.state.busy = true;
        try {
            await this.transfer(id, "A", "C");
        } finally {
            this.state.busy = false;
        }
    }

    /** Return temporarily moved plates from Stack B to their original Stack A positions (LIFO). */
    async returnTemporaryPlates() {
        if (this.state.busy || !this.nextReturnId) {
            return;
        }
        this.state.busy = true;
        try {
            // Park over Stack B in two-column space before the first lift.
            const { crane } = this.state;
            const startPos = this.normalizeCranePos(crane.pos);
            if (startPos !== "B") {
                crane.phase = "moving";
                crane.pos = "B";
                await this.wait(TRAVEL_MS);
                if (!this.alive) {
                    return;
                }
                crane.phase = "idle";
            }
            while (this.alive && this.nextReturnId) {
                const id = this.nextReturnId;
                // Always return to Stack A (original stack for temporary moves).
                await this.transfer(id, "B", "A");
            }
            if (!this.temporaryPlateIds.length) {
                this.state.restoreComplete = true;
                crane.phase = "moving";
                crane.pos = "home";
                await this.wait(TRAVEL_MS);
                crane.phase = "idle";
            }
        } finally {
            this.state.busy = false;
        }
    }

    reset() {
        if (!this.state.busy) {
            Object.assign(this.state, demoYard());
        }
    }

    openMoveScreen() {
        this.actionService.doAction(MOVE_ACTION);
    }

    openDropScreen() {
        this.actionService.doAction(DROP_ACTION);
    }

    openRestoreScreen() {
        this.actionService.doAction(RESTORE_ACTION);
    }

    async transfer(id, from, to) {
        const { crane, stacks, plates } = this.state;
        this.state.landedId = null;

        const fromPos = this.normalizeCranePos(from);
        const toPos = this.normalizeCranePos(to);

        // Travel to source stack (skip wait if already there — avoids a stutter).
        crane.phase = "moving";
        if (this.normalizeCranePos(crane.pos) !== fromPos) {
            crane.pos = fromPos;
            await this.wait(TRAVEL_MS);
            if (!this.alive) {
                return;
            }
        } else {
            crane.pos = fromPos;
        }

        const fromIndex = stacks[from].indexOf(id);
        if (fromIndex < 0) {
            crane.phase = "idle";
            crane.load = null;
            return;
        }

        // Remember original stack position before temporary move.
        if (to === "B" && from !== "B" && !plates[id].movedFrom) {
            plates[id].homeStack = from;
            plates[id].homeIndex = fromIndex;
            plates[id].movedFrom = from;
        }

        stacks[from].splice(fromIndex, 1);
        crane.load = id;
        crane.phase = "lifting";
        await this.wait(HOOK_MS);
        if (!this.alive) {
            return;
        }

        const restoring = from === "B" && to === "A" && Boolean(plates[id].movedFrom);
        crane.phase = to === "C" || restoring ? "dropping" : "moving";
        crane.pos = toPos;
        await this.wait(TRAVEL_MS);
        if (!this.alive) {
            return;
        }

        if (restoring) {
            // LIFO push restores original stacking order when all temps are returned.
            plates[id].movedFrom = null;
            plates[id].homeStack = null;
            plates[id].homeIndex = null;
        }

        stacks[to].push(id);
        crane.load = null;
        crane.phase = "idle";
        this.state.landedId = id;
        await this.wait(HOOK_MS);
    }

    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export class DropToTruck extends PlatePicking {
    static mode = "drop";
}

export class ReturnTemporaryPlates extends PlatePicking {
    static mode = "restore";
}

registry.category("actions").add("crane_yard_operator.move_plates", PlatePicking);
registry.category("actions").add("crane_yard_operator.drop_truck", DropToTruck);
registry.category("actions").add("crane_yard_operator.return_plates", ReturnTemporaryPlates);
