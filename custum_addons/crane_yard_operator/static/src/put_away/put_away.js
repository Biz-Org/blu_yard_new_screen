/** @odoo-module **/

import { Component, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { CraneYardNav } from "@crane_yard_operator/crane_nav/crane_nav";

const TEMP_ZONE = "Temporary Zone";
const TRAVEL_MS = 700;
const HOOK_MS = 380;
/** Cache-bust for bin-corner badge + crane throw animation. */
const PUT_AWAY_UI_REV = "pipe-pyramid-absolute-slots-20261017";

/** Pixel layout for fixed pipe-pyramid slots (must match CSS). */
const PY_PIPE_W = 78;
const PY_PIPE_H = 96;
const PY_GAP_X = 14;
const PY_GAP_Y = 14;

/** Configurable bin colours — change here to re-theme every pipe / task / bin. */
export const BIN_COLORS = {
    A1: { code: "A1", label: "Bin A1", color: "#eab308", text: "#713f12" },
    A2: { code: "A2", label: "Bin A2", color: "#94a3b8", text: "#1e293b" },
    B1: { code: "B1", label: "Bin B1", color: "#22c55e", text: "#14532d" },
    B2: { code: "B2", label: "Bin B2", color: "#3b82f6", text: "#1e3a8a" },
};

const BIN_ORDER = Object.keys(BIN_COLORS);

/** Crane trolley % left positions over waiting area and destination bins. */
const CRANE_X = {
    home: 22,
    wait: 18,
    A1: 58,
    A2: 82,
    B1: 58,
    B2: 82,
    temp: 90,
};

function demoPlateLoad() {
    return {
        items: [
            { id: "PL-001", size: "10 mm", targetBin: "A1", status: "pending", location: null },
            { id: "PL-002", size: "12 mm", targetBin: "A1", status: "pending", location: null },
            { id: "PL-003", size: "16 mm", targetBin: "A2", status: "pending", location: null },
            { id: "PL-004", size: "20 mm", targetBin: "A2", status: "pending", location: null },
            { id: "PL-005", size: "10 mm", targetBin: "B1", status: "pending", location: null },
            { id: "PL-006", size: "12 mm", targetBin: "B1", status: "pending", location: null },
            { id: "PL-007", size: "25 mm", targetBin: "B2", status: "pending", location: null },
        ],
        selectedId: "PL-001",
        busy: false,
        landedId: null,
        crane: { x: CRANE_X.home, load: null, phase: "idle", task: null },
    };
}

function demoPipeLoad() {
    const items = [
        { id: "P-101", size: "20 mm", targetBin: "A1", status: "pending", location: null },
        { id: "P-102", size: "25 mm", targetBin: "A1", status: "pending", location: null },
        { id: "P-103", size: "32 mm", targetBin: "A2", status: "pending", location: null },
        { id: "P-104", size: "40 mm", targetBin: "A2", status: "pending", location: null },
        { id: "P-105", size: "20 mm", targetBin: "B1", status: "pending", location: null },
        { id: "P-106", size: "50 mm", targetBin: "B1", status: "pending", location: null },
        { id: "P-107", size: "63 mm", targetBin: "B2", status: "pending", location: null },
    ];
    // Lock each pipe into a fixed pyramid slot so crane pick does not reshuffle the stack.
    assignPyramidSlots(items);
    return {
        items,
        selectedId: "P-101",
        busy: false,
        landedId: null,
        crane: { x: CRANE_X.home, load: null, phase: "idle", task: null },
    };
}

/** Pyramid row sizes top → bottom. Seven pipes → 1 / 2 / 4. */
export function pyramidRowSizes(count) {
    if (count <= 0) {
        return [];
    }
    const sizes = [];
    let remaining = count;
    let row = 1;
    while (remaining > 0) {
        const take = Math.min(row, remaining);
        sizes.push(take);
        remaining -= take;
        row *= 2;
    }
    return sizes;
}

/** Assign fixed pyramidRow / pyramidCol / rowSize once — layout never collapses when pipes leave. */
export function assignPyramidSlots(items) {
    const sizes = pyramidRowSizes(items.length);
    let idx = 0;
    sizes.forEach((size, row) => {
        for (let col = 0; col < size; col++) {
            if (items[idx]) {
                items[idx].pyramidRow = row;
                items[idx].pyramidCol = col;
                items[idx].pyramidRowSize = size;
            }
            idx++;
        }
    });
    return items;
}

/** Absolute CSS position for a locked pyramid slot (centred stack). */
export function pyramidSlotStyle(row, col, rowSize) {
    const rowWidth = rowSize * PY_PIPE_W + Math.max(0, rowSize - 1) * PY_GAP_X;
    const left = `calc(50% - ${rowWidth / 2}px + ${col * (PY_PIPE_W + PY_GAP_X)}px)`;
    const top = `${row * (PY_PIPE_H + PY_GAP_Y)}px`;
    return `left: ${left}; top: ${top};`;
}

export class PutAway extends Component {
    static template = "crane_yard_operator.PutAway";
    static components = { CraneYardNav };
    static props = ["*"];
    static mode = "plate";

    setup() {
        this.binColors = BIN_COLORS;
        this.binOrder = BIN_ORDER;
        this.state = useState(this.constructor.mode === "pipe" ? demoPipeLoad() : demoPlateLoad());
        this.alive = true;
        onWillUnmount(() => {
            this.alive = false;
        });
    }

    get isPipe() {
        return this.constructor.mode === "pipe";
    }

    get navKey() {
        return this.isPipe ? "pipe_put_away" : "plate_put_away";
    }

    get screenTitle() {
        return this.isPipe ? "Pipe Put Away" : "Plate Put Away";
    }

    get itemNoun() {
        return this.isPipe ? "Pipe" : "Plate";
    }

    get totalCount() {
        return this.state.items.length;
    }

    get pendingCount() {
        return this.state.items.filter((item) => item.status === "pending").length;
    }

    get placedCount() {
        return this.state.items.filter((item) => item.status === "placed").length;
    }

    get temporaryCount() {
        return this.state.items.filter((item) => item.status === "temporary").length;
    }

    get selected() {
        return this.state.items.find((item) => item.id === this.state.selectedId) || null;
    }

    get pendingItems() {
        return this.state.items.filter((item) => item.status === "pending");
    }

    get temporaryItems() {
        return this.state.items.filter((item) => item.status === "temporary");
    }

    get binLegend() {
        return BIN_ORDER.map((code) => BIN_COLORS[code]);
    }

    get bins() {
        const throwingTo =
            this.state.crane.phase === "throwing" &&
            this.state.crane.task === "bin" &&
            this.selected &&
            this.selected.status === "pending"
                ? this.selected.targetBin
                : null;
        return BIN_ORDER.map((code) => {
            const meta = BIN_COLORS[code];
            const isTarget = Boolean(
                this.selected &&
                    this.selected.status === "pending" &&
                    this.selected.targetBin === code
            );
            return {
                ...meta,
                items: this.state.items.filter(
                    (item) => item.status === "placed" && item.location === code
                ),
                isTarget,
                isLanding: throwingTo === code,
                style: `--pw-bin: ${meta.color}; --pw-bin-text: ${meta.text};`,
            };
        });
    }

    /**
     * Fixed absolute pyramid slots. Each pipe keeps its pixel position forever;
     * putting one away only clears that slot — neighbours do not move.
     */
    get pyramidSlots() {
        return this.state.items
            .filter((item) => item.pyramidRow != null)
            .map((item) => {
                const show = item.status === "pending" && this.state.crane.load !== item.id;
                return {
                    key: `${item.pyramidRow}-${item.pyramidCol}`,
                    item: show ? item : null,
                    style: pyramidSlotStyle(item.pyramidRow, item.pyramidCol, item.pyramidRowSize || 1),
                };
            });
    }

    get pyramidHeight() {
        const rows = this.state.items.reduce((max, item) => {
            if (item.pyramidRow == null) {
                return max;
            }
            return Math.max(max, item.pyramidRow + 1);
        }, 0);
        return Math.max(rows * (PY_PIPE_H + PY_GAP_Y), PY_PIPE_H);
    }

    get taskList() {
        return this.state.items.map((item, index) => {
            const bin = BIN_COLORS[item.targetBin];
            return {
                ...item,
                index: index + 1,
                locationLabel: this.locationLabel(item),
                statusLabel: this.statusLabel(item),
                binColor: bin.color,
                binText: bin.text,
                binLabel: bin.label,
                style: `--pw-bin: ${bin.color}; --pw-bin-text: ${bin.text};`,
            };
        });
    }

    get selectedDetail() {
        const item = this.selected;
        if (!item) {
            return null;
        }
        const bin = BIN_COLORS[item.targetBin];
        return {
            ...item,
            binLabel: bin.label,
            binColor: bin.color,
            style: `--pw-bin: ${bin.color}; --pw-bin-text: ${bin.text};`,
        };
    }

    get craneLoadItem() {
        const id = this.state.crane.load;
        return id ? this.state.items.find((item) => item.id === id) || null : null;
    }

    get craneStatus() {
        const { phase, task } = this.state.crane;
        if (phase === "lifting") {
            return { title: "Picking", text: `Lifting ${this.itemNoun.toLowerCase()}`, tone: "orange" };
        }
        if (phase === "throwing" || phase === "dropping") {
            return {
                title: task === "temp" ? "To Temporary" : "Throwing to Bin",
                text: "Crane is moving the load",
                tone: "primary",
            };
        }
        if (phase === "moving") {
            return { title: "Moving", text: "Travelling", tone: "primary" };
        }
        return { title: "Ready", text: "Select item and confirm put-away", tone: "muted" };
    }

    binMeta(code) {
        return BIN_COLORS[code] || { color: "#94a3b8", text: "#1e293b", label: code, code };
    }

    /** Corner badge text: allocated / placed bin code, or TEMP. */
    binBadge(item) {
        if (!item) {
            return "";
        }
        if (item.status === "temporary") {
            return "TEMP";
        }
        if (item.status === "placed" && item.location) {
            return item.location;
        }
        return item.targetBin || "";
    }

    locationLabel(item) {
        if (item.status === "placed") {
            return `Bin ${item.location}`;
        }
        if (item.status === "temporary") {
            return TEMP_ZONE;
        }
        return "Waiting in yard";
    }

    statusLabel(item) {
        if (item.status === "placed") {
            return "Placed";
        }
        if (item.status === "temporary") {
            return "Temporary";
        }
        return "Pending";
    }

    pipeStyle(item) {
        if (item.status === "temporary") {
            return "";
        }
        const bin = this.binMeta(item.targetBin);
        return `--pw-bin: ${bin.color}; --pw-bin-text: ${bin.text};`;
    }

    pipeClass(item, context = "pyramid") {
        const classes = ["o_pw_pipe", `o_pw_pipe--${context}`];
        if (item.status === "temporary") {
            classes.push("o_pw_pipe--temp");
        } else {
            classes.push("o_pw_pipe--bin");
        }
        if (item.status === "placed") {
            classes.push("o_pw_pipe--placed");
        }
        if (item.id === this.state.selectedId) {
            classes.push("is-selected");
        }
        if (item.id === this.state.landedId) {
            classes.push("is-landed");
        }
        if (item.id === this.state.crane.load) {
            classes.push("is-on-hook");
        }
        return classes.join(" ");
    }

    plateClass(item, context = "wait") {
        const classes = ["o_pw_plate", `o_pw_plate--${context}`];
        if (item.status === "temporary") {
            classes.push("o_pw_plate--temp");
        } else {
            classes.push("o_pw_plate--bin");
        }
        if (item.status === "placed") {
            classes.push("o_pw_plate--placed");
        }
        if (item.id === this.state.selectedId) {
            classes.push("is-selected");
        }
        if (item.id === this.state.landedId) {
            classes.push("is-landed");
        }
        if (item.id === this.state.crane.load) {
            classes.push("is-on-hook");
        }
        return classes.join(" ");
    }

    itemClass(item, context = "pyramid") {
        return this.isPipe ? this.pipeClass(item, context) : this.plateClass(item, context);
    }

    get totalLabel() {
        return this.isPipe ? "Total Pipes" : "Total Plates";
    }

    taskClass(item) {
        const classes = ["o_pw_task"];
        if (item.id === this.state.selectedId) {
            classes.push("is-selected");
        }
        classes.push(`o_pw_task--${item.status}`);
        return classes.join(" ");
    }

    selectItem(item) {
        if (this.state.busy) {
            return;
        }
        this.state.selectedId = item.id;
    }

    craneXForDest(dest) {
        if (dest === "temp") {
            return CRANE_X.temp;
        }
        return CRANE_X[dest] ?? CRANE_X.home;
    }

    /**
     * Animate crane: pick from waiting area, throw/travel to destination, drop.
     * dest = bin code (A1…) or "temp".
     */
    async throwWithCrane(item, dest) {
        const { crane } = this.state;
        this.state.landedId = null;
        crane.task = dest === "temp" ? "temp" : "bin";

        crane.phase = "moving";
        crane.x = CRANE_X.wait;
        await this.wait(TRAVEL_MS);
        if (!this.alive) {
            return;
        }

        crane.load = item.id;
        crane.phase = "lifting";
        await this.wait(HOOK_MS);
        if (!this.alive) {
            return;
        }

        crane.phase = "throwing";
        crane.x = this.craneXForDest(dest);
        await this.wait(TRAVEL_MS);
        if (!this.alive) {
            return;
        }

        crane.phase = "dropping";
        await this.wait(HOOK_MS);
        if (!this.alive) {
            return;
        }

        if (dest === "temp") {
            item.status = "temporary";
            item.location = TEMP_ZONE;
        } else {
            item.status = "placed";
            item.location = dest;
        }

        crane.load = null;
        crane.phase = "idle";
        crane.task = null;
        this.state.landedId = item.id;
        this._selectNextPending();
        await this.wait(HOOK_MS);
    }

    /** Place selected pending item only into its allocated bin (with crane throw). */
    async placeInBin(binCode) {
        const item = this.selected;
        if (this.state.busy || !item || item.status !== "pending") {
            return;
        }
        if (item.targetBin !== binCode) {
            return;
        }
        this.state.busy = true;
        try {
            await this.throwWithCrane(item, binCode);
        } finally {
            this.state.busy = false;
        }
    }

    async confirmPutAway() {
        const item = this.selected;
        if (item && item.status === "pending" && !this.state.busy) {
            await this.placeInBin(item.targetBin);
        }
    }

    async putToTemporary() {
        const item = this.selected;
        if (this.state.busy || !item || item.status !== "pending") {
            return;
        }
        this.state.busy = true;
        try {
            await this.throwWithCrane(item, "temp");
        } finally {
            this.state.busy = false;
        }
    }

    _selectNextPending() {
        const next = this.state.items.find((entry) => entry.status === "pending");
        this.state.selectedId = next ? next.id : this.state.items[this.state.items.length - 1].id;
    }

    reset() {
        if (!this.state.busy) {
            Object.assign(this.state, this.isPipe ? demoPipeLoad() : demoPlateLoad());
        }
    }

    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export class PipePutAway extends PutAway {
    static mode = "pipe";
}

registry.category("actions").add("crane_yard_operator.plate_put_away", PutAway);
registry.category("actions").add("crane_yard_operator.pipe_put_away", PipePutAway);
