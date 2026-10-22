/** @odoo-module **/

import { Component, onWillUnmount, reactive, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { CraneYardNav } from "@crane_yard_operator/crane_nav/crane_nav";

const TRAVEL_MS = 700;
const HOOK_MS = 350;
/** Cache-bust asset rebuild for return-temp + stable pyramid slots. */
const PIPE_UI_REV = "return-fill-bottom-empties-20261017";

// Four-floor pyramid: bottom has BASE_COUNT pipes, each floor above has one fewer.
const BASE_COUNT = 4;

const PYRAMID_LEFT = 4;
const PYRAMID_WIDTH = 56;
const DEST_X = 81;
const CRANE_HOME = PYRAMID_LEFT + PYRAMID_WIDTH / 2;

const UNSTACK_ACTION = "crane_yard_operator.action_pipe_unstack";
const DROP_ACTION = "crane_yard_operator.action_pipe_drop";
const RESTORE_ACTION = "crane_yard_operator.action_pipe_return";

/**
 * Current Sales Order pick list — pipe numbers in the pyramid that belong to this SO.
 * Locations use bin/row/slot codes from yard data (not free-typed labels).
 */
const PICK_PIPE_NUMBERS = [7, 8, 3];

/** Per-pipe yard codes: bin + slot used in the order panel and tooltips. */
const PIPE_YARD_META = {
    1: { binCode: "LA02", slotCode: "R1/01", soNumber: "50#02" },
    2: { binCode: "LA02", slotCode: "R1/02", soNumber: "50#02" },
    3: { binCode: "LA03", slotCode: "R1/03", soNumber: "50#01" },
    4: { binCode: "LA02", slotCode: "R1/04", soNumber: "50#02" },
    5: { binCode: "LA02", slotCode: "R2/05", soNumber: "50#03" },
    6: { binCode: "LA02", slotCode: "R2/06", soNumber: "50#03" },
    7: { binCode: "LA02", slotCode: "R2/07", soNumber: "50#01" },
    8: { binCode: "LA02", slotCode: "R2/08", soNumber: "50#01" },
    9: { binCode: "LA03", slotCode: "R3/09", soNumber: "50#03" },
    10: { binCode: "LA03", slotCode: "R4/10", soNumber: "50#03" },
};

const DEMO_ORDER = {
    soNumber: "50#01",
    binLocation: "LA02",
    truck: "TR-01",
    ref: "RM/PICK/0001",
};

const MOVE_STEPS = [
    { id: 1, label: "Pick List" },
    { id: 2, label: "Unstack Upper Pipes" },
    { id: 3, label: "Ready to Pick" },
];

const DROP_STEPS = [
    { id: 1, label: "Pick Pipe" },
    { id: 2, label: "Drop into Truck" },
    { id: 3, label: "Completed" },
];

const RESTORE_STEPS = [
    { id: 1, label: "Temp Stack" },
    { id: 2, label: "Return to Pyramid" },
    { id: 3, label: "Completed" },
];

function yardMetaFor(num) {
    return PIPE_YARD_META[num] || { binCode: "LA02", slotCode: `R?/${String(num).padStart(2, "0")}`, soNumber: DEMO_ORDER.soNumber };
}

function yardPath(pipe) {
    return `${pipe.binCode}/${pipe.slotCode}`;
}

function demoPyramid() {
    const pipes = {};
    let number = 1;
    for (let row = 0; row < BASE_COUNT; row++) {
        for (let col = 0; col < BASE_COUNT - row; col++) {
            const num = number++;
            const label = String(num).padStart(2, "0");
            const id = `P-${label}`;
            const meta = yardMetaFor(num);
            const selected = PICK_PIPE_NUMBERS.includes(num);
            pipes[id] = {
                id,
                label,
                num,
                row,
                col,
                homeRow: row,
                homeCol: col,
                selected,
                soNumber: meta.soNumber,
                binCode: meta.binCode,
                slotCode: meta.slotCode,
                location: "pyramid",
            };
        }
    }
    return {
        order: {
            soNumber: DEMO_ORDER.soNumber,
            binLocation: DEMO_ORDER.binLocation,
            truck: DEMO_ORDER.truck,
            ref: DEMO_ORDER.ref,
            availablePipes: PICK_PIPE_NUMBERS.length,
        },
        pipes,
        rack: [],
        truck: [],
        landedId: null,
        busy: false,
        showLoadingComplete: false,
        loadingConfirmed: false,
        restoreComplete: false,
        crane: { x: CRANE_HOME, load: null, target: null, task: null, phase: "idle" },
    };
}

const pyramid = reactive(demoPyramid());

export class PipePicking extends Component {
    static template = "crane_yard_operator.PipePicking";
    static components = { CraneYardNav };
    static props = ["*"];
    static mode = "unstack";

    setup() {
        this.state = useState(pyramid);
        this.actionService = useService("action");
        this.alive = true;
        onWillUnmount(() => {
            this.alive = false;
        });
    }

    get mode() {
        return this.constructor.mode;
    }

    get isUnstackScreen() {
        return this.mode === "unstack";
    }

    get isDropScreen() {
        return this.mode === "drop";
    }

    get isRestoreScreen() {
        return this.mode === "restore";
    }

    get navKey() {
        if (this.isUnstackScreen) {
            return "pipe_unstack";
        }
        if (this.isRestoreScreen) {
            return "pipe_return";
        }
        return "pipe_drop";
    }

    get screenTitle() {
        if (this.isUnstackScreen) {
            return "Pipe Picking – Unstack Upper Pipes";
        }
        if (this.isRestoreScreen) {
            return "Pipe Picking – Return Temporary Pipes";
        }
        return "Pipe Picking – Drop to Truck";
    }

    // ------------------------------------------------------------------
    // Order information panel
    // ------------------------------------------------------------------

    get orderPanel() {
        const required = this.selectedPipes;
        const loaded = required.filter((p) => p.location === "truck").length;
        return {
            soNumber: this.state.order.soNumber,
            binLocation: this.state.order.binLocation,
            availablePipes: this.state.order.availablePipes,
            loaded,
            remaining: this.state.order.availablePipes - loaded,
            requiredLocations: required
                .slice()
                .sort((a, b) => PICK_PIPE_NUMBERS.indexOf(a.num) - PICK_PIPE_NUMBERS.indexOf(b.num))
                .map((pipe) => ({
                    id: pipe.id,
                    path: this.currentYardPath(pipe),
                    status: this.pipeStatus(pipe),
                })),
        };
    }

    currentYardPath(pipe) {
        if (pipe.location === "truck") {
            return `Truck ${this.state.order.truck}`;
        }
        if (pipe.location === "rack") {
            return `Temp ← ${yardPath(pipe)}`;
        }
        if (pipe.location === "hook") {
            return "On Crane";
        }
        return yardPath(pipe);
    }

    // ------------------------------------------------------------------
    // Pyramid geometry
    // ------------------------------------------------------------------

    get pyramidPipes() {
        return Object.values(this.state.pipes).filter((p) => p.location === "pyramid");
    }

    /**
     * Fixed pyramid slots (including empties) so remaining pipes keep their
     * geometric positions when others are picked or moved — no visual jumbling.
     */
    get floorRows() {
        const rows = [];
        for (let row = BASE_COUNT - 1; row >= 0; row--) {
            const slots = [];
            for (let col = 0; col < BASE_COUNT - row; col++) {
                slots.push({
                    key: `r${row}c${col}`,
                    row,
                    col,
                    pipe: this.pipeAt(row, col) || null,
                });
            }
            rows.push({ row, label: `R${row + 1}`, slots });
        }
        return rows;
    }

    pipeAt(row, col) {
        return this.pyramidPipes.find((p) => p.row === row && p.col === col);
    }

    pipesOn(pipe) {
        return [this.pipeAt(pipe.row + 1, pipe.col - 1), this.pipeAt(pipe.row + 1, pipe.col)].filter(Boolean);
    }

    pipesAbove(pipe) {
        const above = new Map();
        const queue = this.pipesOn(pipe);
        while (queue.length) {
            const current = queue.shift();
            if (!above.has(current.id)) {
                above.set(current.id, current);
                queue.push(...this.pipesOn(current));
            }
        }
        return [...above.values()];
    }

    isFree(pipe) {
        return pipe.location === "pyramid" && !this.pipesOn(pipe).length;
    }

    pipeLocation(pipe) {
        return `Row ${pipe.row + 1}, Pos ${pipe.col + 1}`;
    }

    pipeX(pipe) {
        const cols = BASE_COUNT - pipe.row;
        const colCenter = (pipe.col + 0.5) / cols;
        const leftPad = (pipe.row / BASE_COUNT) * 0.5;
        const usable = 1 - pipe.row / BASE_COUNT;
        return PYRAMID_LEFT + PYRAMID_WIDTH * (leftPad + colCenter * usable);
    }

    // ------------------------------------------------------------------
    // Selection & unstacking
    // ------------------------------------------------------------------

    get selectedPipes() {
        return Object.values(this.state.pipes).filter((p) => p.selected);
    }

    get selectedInPyramid() {
        return this.pyramidPipes.filter((p) => p.selected);
    }

    get blockers() {
        const blockers = new Map();
        for (const pipe of this.selectedInPyramid) {
            for (const above of this.pipesAbove(pipe)) {
                if (!above.selected) {
                    blockers.set(above.id, above);
                }
            }
        }
        return [...blockers.values()].sort((a, b) => b.row - a.row || a.col - b.col);
    }

    get removableBlockers() {
        return this.blockers.filter((p) => this.isFree(p));
    }

    get pickablePipes() {
        return this.selectedInPyramid
            .filter((p) => this.isFree(p))
            .sort((a, b) => b.row - a.row || a.col - b.col);
    }

    get nextPick() {
        return this.pickablePipes[0] || null;
    }

    get allDropped() {
        const required = this.selectedPipes;
        return (
            required.length > 0 &&
            required.every((p) => p.location === "truck") &&
            !this.loadIsSelected
        );
    }

    get loadIsSelected() {
        const load = this.state.crane.load;
        return Boolean(load && this.state.pipes[load].selected);
    }

    /**
     * Empty pyramid slots, bottom row first then upward (R1 → R2 → R3 → R4),
     * left-to-right within each row — used when returning temporary pipes.
     */
    get emptyPyramidSlots() {
        const slots = [];
        for (let row = 0; row < BASE_COUNT; row++) {
            for (let col = 0; col < BASE_COUNT - row; col++) {
                if (!this.pipeAt(row, col)) {
                    slots.push({ row, col });
                }
            }
        }
        return slots;
    }

    /** A slot is placeable only if lower supporting pipes exist (or it is on the bottom row). */
    slotHasSupport(row, col) {
        if (row <= 0) {
            return true;
        }
        const lowerCols = BASE_COUNT - (row - 1);
        // Nestled pipe needs both groove supports when those lower positions exist.
        if (col < lowerCols && !this.pipeAt(row - 1, col)) {
            return false;
        }
        if (col + 1 < lowerCols && !this.pipeAt(row - 1, col + 1)) {
            return false;
        }
        return true;
    }

    /** Next empty slot to fill when returning: bottom line first, then 2nd row, then 3rd… */
    get nextFillSlot() {
        for (const slot of this.emptyPyramidSlots) {
            if (this.slotHasSupport(slot.row, slot.col)) {
                return slot;
            }
        }
        return null;
    }

    fillWouldBlockRequired(slot) {
        if (!slot || slot.row <= 0) {
            return false;
        }
        const lowers = [this.pipeAt(slot.row - 1, slot.col), this.pipeAt(slot.row - 1, slot.col + 1)].filter(
            Boolean
        );
        return lowers.some((lower) => lower.selected);
    }

    /** Temporary pipes currently on the rack (never include SO-required pipes). */
    get temporaryRackPipes() {
        return this.state.rack
            .map((id) => this.state.pipes[id])
            .filter((pipe) => pipe.location === "rack" && !pipe.selected);
    }

    /**
     * Next temp pipe to return (LIFO from Temporary Stack) into the next bottom-up empty slot.
     */
    get nextReturnPipe() {
        const slot = this.nextFillSlot;
        if (!slot) {
            return null;
        }
        if (!this.allDropped && this.fillWouldBlockRequired(slot)) {
            return null;
        }
        for (let i = this.state.rack.length - 1; i >= 0; i--) {
            const pipe = this.state.pipes[this.state.rack[i]];
            if (pipe && !pipe.selected && pipe.location === "rack") {
                return pipe;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Visual state
    // ------------------------------------------------------------------

    pipeStatus(pipe) {
        if (pipe.location === "truck") {
            return "done";
        }
        if (pipe.location === "rack") {
            return "unstacked";
        }
        if (pipe.selected) {
            return this.isFree(pipe) ? "ready" : "selected";
        }
        if (this.blockers.some((p) => p.id === pipe.id)) {
            return "unstack";
        }
        return "normal";
    }

    pipeClass(pipe) {
        const status = this.pipeStatus(pipe);
        const classes = ["o_cy_pipe", `o_cy_pipe--${status === "ready" ? "selected" : status}`];
        if (this.isDropScreen && status === "ready" && !this.state.busy) {
            classes.push("is-pickable");
        } else {
            classes.push("is-static");
        }
        if (pipe.id === this.state.crane.target) {
            classes.push("is-target");
        }
        if (pipe.id === this.state.landedId) {
            classes.push("is-landed");
        }
        return classes.join(" ");
    }

    pipeTooltip(pipe) {
        const lines = [
            `Pipe: ${pipe.id}`,
            `SO: ${pipe.soNumber}`,
            `Location: ${this.currentYardPath(pipe)}`,
            `Status: ${this.pipeStatus(pipe)}`,
        ];
        return lines.join("\n");
    }

    showTruckBadge(pipe) {
        return this.isDropScreen && this.pipeStatus(pipe) === "ready";
    }

    get hookClass() {
        const load = this.state.pipes[this.state.crane.load];
        const tone = load.selected ? "o_cy_pipe--selected" : "o_cy_pipe--unstack";
        return `o_cy_pipe o_cy_pipe--mini o_cy_hook_pipe ${tone} is-target`;
    }

    get rackPipes() {
        return this.state.rack.map((id) => this.state.pipes[id]);
    }

    get truckPipes() {
        return this.state.truck.map((id) => this.state.pipes[id]);
    }

    get selectedList() {
        return this.selectedPipes
            .slice()
            .sort((a, b) => PICK_PIPE_NUMBERS.indexOf(a.num) - PICK_PIPE_NUMBERS.indexOf(b.num))
            .map((pipe) => {
                let status = "selected";
                let label;
                if (pipe.location === "truck") {
                    status = "done";
                    label = "In Truck";
                } else if (pipe.location === "hook") {
                    status = "ready";
                    label = "On Crane";
                } else if (this.isFree(pipe)) {
                    status = "ready";
                    label = "Ready to Pick";
                } else {
                    const upper = this.pipesAbove(pipe).filter((p) => !p.selected).length;
                    label = upper ? `Unstack ${upper} above` : "Under green pipe";
                }
                return {
                    id: pipe.id,
                    soNumber: pipe.soNumber || "",
                    location: this.currentYardPath(pipe),
                    status,
                    label,
                };
            });
    }

    // ------------------------------------------------------------------
    // Status, KPIs, steps
    // ------------------------------------------------------------------

    get status() {
        const { phase, load, target, task } = this.state.crane;
        if (this.state.busy && task === "unstack") {
            const id = load || target;
            return {
                tone: "red",
                icon: "fa-arrow-up",
                title: "Unstacking Upper Pipe",
                text: `Moving ${id} to the Temporary Stack (original position saved).`,
            };
        }
        if (this.state.busy && task === "restore") {
            return {
                tone: "primary",
                icon: "fa-reply",
                title: "Restoring Temporary Pipe",
                text: `Returning ${load || target} to its original pyramid slot.`,
            };
        }
        if (this.state.busy && task === "pick") {
            if (phase === "idle") {
                return { tone: "blue", icon: "fa-check-circle", title: "Pipe Successfully Loaded", text: `${target} is on truck ${this.state.order.truck}.` };
            }
            if (phase === "dropping") {
                return { tone: "orange", icon: "fa-truck", title: "Loading Truck", text: `Carrying ${load} to the truck.` };
            }
            return { tone: "orange", icon: "fa-hand-paper-o", title: "Picking Pipe", text: `Crane is picking ${load || target}.` };
        }
        if (this.isRestoreScreen) {
            const temps = this.temporaryRackPipes.length;
            if (this.state.restoreComplete && !temps) {
                return {
                    tone: "green",
                    icon: "fa-check-circle",
                    title: "Temporary Pipes Returned",
                    text: "Temporary pipes filled empty pyramid slots from the bottom row upward.",
                };
            }
            if (!temps) {
                return {
                    tone: "primary",
                    icon: "fa-info-circle",
                    title: "No Temporary Pipes",
                    text: "Unstack upper pipes to the Temporary Stack first, then return them here after picking.",
                };
            }
            if (!this.nextReturnPipe) {
                return {
                    tone: "orange",
                    icon: "fa-truck",
                    title: "Finish Truck Loading First",
                    text: "Returning pipes now would cover remaining green picks. Complete Drop to Truck, then return.",
                };
            }
            const slot = this.nextFillSlot;
            const slotLabel = slot ? `R${slot.row + 1} / Pos ${slot.col + 1}` : "next empty";
            return {
                tone: "primary",
                icon: "fa-reply",
                title: "Return Temporary Pipes",
                text: `${temps} on Temporary Stack. Next fill: bottom-up empty at ${slotLabel}.`,
            };
        }
        if (this.allDropped) {
            if (this.temporaryRackPipes.length) {
                return {
                    tone: "primary",
                    icon: "fa-reply",
                    title: "Return Temporary Pipes",
                    text: `${this.temporaryRackPipes.length} pipe${this.temporaryRackPipes.length > 1 ? "s remain" : " remains"} on the Temporary Stack. Open Return Temporary Pipes.`,
                };
            }
            return {
                tone: "blue",
                icon: "fa-check-circle",
                title: this.state.loadingConfirmed ? "Loading Confirmed" : "Loading Complete",
                text: `${this.state.truck.length} / ${this.state.order.availablePipes} required pipes are on truck ${this.state.order.truck}.`,
            };
        }
        const selected = this.selectedInPyramid.length;
        if (!selected && !this.allDropped) {
            return {
                tone: "primary",
                icon: "fa-list",
                title: "No Pipes to Pick",
                text: "There are no pipes left on the pick list in the pyramid.",
            };
        }
        const blockers = this.blockers.length;
        if (this.isUnstackScreen) {
            if (blockers && this.removableBlockers.length) {
                return {
                    tone: "red",
                    icon: "fa-arrow-up",
                    title: "Unstack Upper Pipe First",
                    text: `${blockers} pipe${blockers > 1 ? "s are" : " is"} stacked above the green pipes. Press Unstack Upper Pipes.`,
                };
            }
            if (blockers) {
                return {
                    tone: "orange",
                    icon: "fa-truck",
                    title: "Drop Upper Green Pipe First",
                    text: "A green pipe is resting on an upper pipe. Drop it into the truck, then unstack the rest.",
                };
            }
            return {
                tone: "green",
                icon: "fa-check",
                title: "Pipe Selected",
                text: `${selected} green pipe${selected > 1 ? "s are" : " is"} free to pick. Continue to Pick & Drop.`,
            };
        }
        const next = this.nextPick;
        const landed = this.state.landedId && this.state.pipes[this.state.landedId];
        if (landed && landed.location === "truck") {
            return {
                tone: "blue",
                icon: "fa-check-circle",
                title: "Pipe Successfully Loaded",
                text: `${landed.id} is on truck ${this.state.order.truck}.${next ? ` Next: pick ${next.id} (${this.currentYardPath(next)}).` : ""}`,
            };
        }
        if (next) {
            return {
                tone: "orange",
                icon: "fa-truck",
                title: "Pipe Selected",
                text: `Pick ${next.id} at ${this.currentYardPath(next)} and load it onto truck ${this.state.order.truck}.`,
            };
        }
        return {
            tone: "red",
            icon: "fa-arrow-up",
            title: "Unstack Upper Pipe First",
            text: "Pipes are stacked above the green pipes. Unstack them on the Unstack screen.",
        };
    }

    get craneStatus() {
        const { phase, task } = this.state.crane;
        if (phase === "lifting") {
            return { title: "Picking", text: "Lifting pipe", tone: "orange" };
        }
        if (phase === "dropping") {
            return {
                title: "Dropping",
                text: task === "restore" ? "To original slot" : "To the truck",
                tone: "orange",
            };
        }
        if (phase === "moving") {
            return { title: "Moving", text: "Travelling", tone: "primary" };
        }
        if (this.isRestoreScreen) {
            return { title: "Ready", text: "Return from Temporary Stack", tone: "muted" };
        }
        return { title: "Ready", text: "Waiting for operator", tone: "muted" };
    }

    get progressPercent() {
        const total = this.state.order.availablePipes;
        const loaded = this.selectedPipes.filter((p) => p.location === "truck").length;
        return total ? Math.round((loaded / total) * 100) : 0;
    }

    get restoreStep() {
        if (this.state.crane.task === "restore") {
            return 2;
        }
        if (this.temporaryRackPipes.length) {
            return this.nextReturnPipe ? 2 : 1;
        }
        if (this.state.restoreComplete) {
            return 3;
        }
        return 1;
    }

    get steps() {
        let current;
        let steps;
        if (this.isRestoreScreen) {
            steps = RESTORE_STEPS;
            current = this.restoreStep;
        } else if (this.isUnstackScreen) {
            steps = MOVE_STEPS;
            current = !this.selectedInPyramid.length ? 1 : this.blockers.length ? 2 : 4;
        } else {
            steps = DROP_STEPS;
            current = this.allDropped ? 4 : this.loadIsSelected ? 2 : 1;
        }
        return steps.map((step) => ({
            ...step,
            state:
                step.id < current || (current === steps.length && step.id === current)
                    ? "done"
                    : step.id === current
                    ? "active"
                    : "todo",
        }));
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    onPipeClick(pipe) {
        if (this.state.busy) {
            return;
        }
        // Only free required (green) pipes can be picked on the drop screen.
        if (this.isDropScreen && this.pipeStatus(pipe) === "ready" && pipe.selected) {
            this.pickPipe(pipe);
        }
    }

    async unstackUpperPipes() {
        if (this.state.busy || !this.removableBlockers.length) {
            return;
        }
        this.state.busy = true;
        this.state.restoreComplete = false;
        try {
            while (this.alive && this.removableBlockers.length) {
                await this.transfer(this.removableBlockers[0], "rack");
            }
        } finally {
            this.state.busy = false;
        }
    }

    pickNext() {
        return this.pickPipe(this.nextPick);
    }

    async pickPipe(pipe) {
        if (this.state.busy || !pipe || !pipe.selected || !this.isFree(pipe)) {
            return;
        }
        if (pipe.location === "truck" || this.state.truck.includes(pipe.id)) {
            return;
        }
        this.state.busy = true;
        try {
            // Do not auto-restore here — that jumbles the pyramid during picking.
            // Temporary pipes return on the Return Temporary Pipes screen.
            await this.transfer(pipe, "truck");
            if (this.allDropped && !this.state.loadingConfirmed) {
                this.state.showLoadingComplete = true;
            }
        } finally {
            this.state.busy = false;
        }
    }

    /**
     * Return temporary pipes into empty pyramid slots:
     * 1st → bottom row empty, 2nd → next row empty, 3rd → next… (bottom-up).
     */
    async returnTemporaryPipes() {
        if (this.state.busy || !this.nextReturnPipe) {
            return;
        }
        this.state.busy = true;
        try {
            while (this.alive && this.nextReturnPipe) {
                await this.transfer(this.nextReturnPipe, "pyramid");
            }
            if (!this.temporaryRackPipes.length) {
                this.state.restoreComplete = true;
                this.state.crane.phase = "moving";
                this.state.crane.x = CRANE_HOME;
                await this.wait(TRAVEL_MS);
                this.state.crane.phase = "idle";
            }
        } finally {
            this.state.busy = false;
        }
    }

    confirmLoadingComplete() {
        this.state.showLoadingComplete = false;
        this.state.loadingConfirmed = true;
    }

    reset() {
        if (!this.state.busy) {
            Object.assign(this.state, demoPyramid());
        }
    }

    openUnstackScreen() {
        this.actionService.doAction(UNSTACK_ACTION);
    }

    openDropScreen() {
        this.actionService.doAction(DROP_ACTION);
    }

    openRestoreScreen() {
        this.actionService.doAction(RESTORE_ACTION);
    }

    async transfer(pipe, destination) {
        const { crane } = this.state;
        this.state.landedId = null;
        crane.target = pipe.id;

        if (destination === "truck") {
            crane.task = "pick";
        } else if (destination === "pyramid") {
            crane.task = "restore";
        } else {
            crane.task = "unstack";
        }

        // Capture home once before leaving the pyramid for temporary moves.
        if (destination === "rack" && pipe.location === "pyramid") {
            pipe.homeRow = pipe.row;
            pipe.homeCol = pipe.col;
        }

        // When returning: lock the next bottom-up empty slot for this throw.
        let restoreSlot = null;
        if (destination === "pyramid") {
            restoreSlot = this.nextFillSlot || { row: pipe.homeRow, col: pipe.homeCol };
            pipe.restoreRow = restoreSlot.row;
            pipe.restoreCol = restoreSlot.col;
        }

        const sourceX =
            pipe.location === "pyramid"
                ? this.pipeX(pipe)
                : destination === "pyramid"
                ? this.pipeX({ ...pipe, row: pipe.restoreRow, col: pipe.restoreCol })
                : DEST_X;

        crane.phase = "moving";
        if (Math.abs(crane.x - sourceX) > 0.5) {
            crane.x = sourceX;
            await this.wait(TRAVEL_MS);
            if (!this.alive) {
                return;
            }
        } else {
            crane.x = sourceX;
        }

        // Leave previous container (pyramid pipes leave by location change only).
        if (pipe.location === "rack") {
            const idx = this.state.rack.indexOf(pipe.id);
            if (idx >= 0) {
                this.state.rack.splice(idx, 1);
            }
        } else if (pipe.location === "truck") {
            const idx = this.state.truck.indexOf(pipe.id);
            if (idx >= 0) {
                this.state.truck.splice(idx, 1);
            }
        }

        pipe.location = "hook";
        crane.load = pipe.id;
        crane.phase = "lifting";
        await this.wait(HOOK_MS);
        if (!this.alive) {
            return;
        }

        const destX =
            destination === "pyramid"
                ? this.pipeX({ ...pipe, row: pipe.restoreRow, col: pipe.restoreCol })
                : DEST_X;

        crane.phase = destination === "truck" || destination === "pyramid" ? "dropping" : "moving";
        if (Math.abs(crane.x - destX) > 0.5) {
            crane.x = destX;
            await this.wait(TRAVEL_MS);
            if (!this.alive) {
                return;
            }
        } else {
            crane.x = destX;
        }

        if (destination === "pyramid") {
            const row = pipe.restoreRow;
            const col = pipe.restoreCol;
            if (this.pipeAt(row, col)) {
                // Slot taken — put back on temporary stack.
                pipe.location = "rack";
                this.state.rack.push(pipe.id);
            } else {
                pipe.row = row;
                pipe.col = col;
                pipe.homeRow = row;
                pipe.homeCol = col;
                pipe.location = "pyramid";
            }
            delete pipe.restoreRow;
            delete pipe.restoreCol;
        } else {
            pipe.location = destination;
            this.state[destination].push(pipe.id);
        }

        crane.load = null;
        crane.phase = "idle";
        this.state.landedId = pipe.id;
        await this.wait(HOOK_MS);
        crane.target = null;
        crane.task = null;
    }

    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export class PipeDropToTruck extends PipePicking {
    static mode = "drop";
}

export class PipeReturnTemporary extends PipePicking {
    static mode = "restore";
}

registry.category("actions").add("crane_yard_operator.pipe_unstack", PipePicking);
registry.category("actions").add("crane_yard_operator.pipe_drop", PipeDropToTruck);
registry.category("actions").add("crane_yard_operator.pipe_return", PipeReturnTemporary);
