/** @odoo-module **/

import { Component, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { CraneYardNav } from "@crane_yard_operator/crane_nav/crane_nav";
import { BIN_COLORS } from "@crane_yard_operator/put_away/put_away";

const TEMP_ZONE = "Temporary Zone";
const TRAVEL_MS = 700;
const HOOK_MS = 380;
const PLATE_TOP_UI_REV = "plate-top-heat-so-bin-20261017";

const BIN_ORDER = Object.keys(BIN_COLORS);

const CRANE_X = {
    home: 22,
    wait: 18,
    A1: 58,
    A2: 82,
    B1: 58,
    B2: 82,
    temp: 90,
};

/**
 * Top-view plate put-away demo: heat number, SO, allocated bin colour.
 * Crane throws each plate into its allocated bin.
 */
function demoTopPlates() {
    return {
        items: [
            { id: "PL-001", heatNo: "H-40", soNumber: "SO-1001", size: "10 mm", targetBin: "A1", status: "pending", location: null },
            { id: "PL-002", heatNo: "J-55", soNumber: "SO-1001", size: "12 mm", targetBin: "A1", status: "pending", location: null },
            { id: "PL-003", heatNo: "K-55", soNumber: "SO-1002", size: "16 mm", targetBin: "A2", status: "pending", location: null },
            { id: "PL-004", heatNo: "N-80", soNumber: "SO-1002", size: "20 mm", targetBin: "A2", status: "pending", location: null },
            { id: "PL-005", heatNo: "N-80-1", soNumber: "SO-1003", size: "10 mm", targetBin: "B1", status: "pending", location: null },
            { id: "PL-006", heatNo: "N-80-Q", soNumber: "SO-1003", size: "12 mm", targetBin: "B1", status: "pending", location: null },
            { id: "PL-007", heatNo: "N-80", soNumber: "SO-1004", size: "25 mm", targetBin: "B2", status: "pending", location: null },
        ],
        selectedId: "PL-001",
        busy: false,
        landedId: null,
        crane: { x: CRANE_X.home, load: null, phase: "idle", task: null },
    };
}

export class PlatePutAwayTop extends Component {
    static template = "crane_yard_operator.PlatePutAwayTop";
    static components = { CraneYardNav };
    static props = ["*"];

    setup() {
        this.binOrder = BIN_ORDER;
        this.state = useState(demoTopPlates());
        this.alive = true;
        onWillUnmount(() => {
            this.alive = false;
        });
    }

    get navKey() {
        return "plate_put_away_top";
    }

    get totalCount() {
        return this.state.items.length;
    }

    get pendingCount() {
        return this.state.items.filter((i) => i.status === "pending").length;
    }

    get placedCount() {
        return this.state.items.filter((i) => i.status === "placed").length;
    }

    get temporaryCount() {
        return this.state.items.filter((i) => i.status === "temporary").length;
    }

    get selected() {
        return this.state.items.find((i) => i.id === this.state.selectedId) || null;
    }

    get pendingItems() {
        return this.state.items.filter((i) => i.status === "pending");
    }

    get temporaryItems() {
        return this.state.items.filter((i) => i.status === "temporary");
    }

    get binLegend() {
        return BIN_ORDER.map((code) => BIN_COLORS[code]);
    }

    get bins() {
        const throwingTo =
            this.state.crane.phase === "throwing" &&
            this.state.crane.task === "bin" &&
            this.selected?.status === "pending"
                ? this.selected.targetBin
                : null;
        return BIN_ORDER.map((code) => {
            const meta = BIN_COLORS[code];
            const isTarget = Boolean(
                this.selected && this.selected.status === "pending" && this.selected.targetBin === code
            );
            return {
                ...meta,
                items: this.state.items.filter((i) => i.status === "placed" && i.location === code),
                isTarget,
                isLanding: throwingTo === code,
                style: `--pw-bin: ${meta.color}; --pw-bin-text: ${meta.text};`,
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
            style: `--pw-bin: ${bin.color}; --pw-bin-text: ${bin.text};`,
        };
    }

    get taskList() {
        return this.state.items.map((item, index) => {
            const bin = BIN_COLORS[item.targetBin];
            return {
                ...item,
                index: index + 1,
                binLabel: bin.label,
                statusLabel: this.statusLabel(item),
                locationLabel: this.locationLabel(item),
                style: `--pw-bin: ${bin.color}; --pw-bin-text: ${bin.text};`,
            };
        });
    }

    get craneLoadItem() {
        const id = this.state.crane.load;
        return id ? this.state.items.find((i) => i.id === id) || null : null;
    }

    get craneStatus() {
        const { phase, task } = this.state.crane;
        if (phase === "lifting") {
            return { title: "Picking", text: "Lifting plate", tone: "orange" };
        }
        if (phase === "throwing" || phase === "dropping") {
            return {
                title: task === "temp" ? "To Temporary" : "To Allocated Bin",
                text: "Crane moving plate",
                tone: "primary",
            };
        }
        if (phase === "moving") {
            return { title: "Moving", text: "Travelling", tone: "primary" };
        }
        return { title: "Ready", text: "Select plate · Confirm put-away", tone: "muted" };
    }

    binMeta(code) {
        return BIN_COLORS[code] || { color: "#94a3b8", text: "#1e293b", label: code, code };
    }

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

    plateStyle(item) {
        if (item.status === "temporary") {
            return "";
        }
        const bin = this.binMeta(item.targetBin);
        return `--pw-bin: ${bin.color}; --pw-bin-text: ${bin.text};`;
    }

    plateClass(item, context = "wait") {
        const classes = ["o_pt_plate", `o_pt_plate--${context}`];
        if (item.status === "temporary") {
            classes.push("o_pt_plate--temp");
        } else {
            classes.push("o_pt_plate--bin");
        }
        if (item.status === "placed") {
            classes.push("o_pt_plate--placed");
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

    taskClass(item) {
        const classes = ["o_pt_task", `o_pt_task--${item.status}`];
        if (item.id === this.state.selectedId) {
            classes.push("is-selected");
        }
        return classes.join(" ");
    }

    locationLabel(item) {
        if (item.status === "placed") {
            return `Bin ${item.location}`;
        }
        if (item.status === "temporary") {
            return TEMP_ZONE;
        }
        return `Allocated ${item.targetBin}`;
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

    selectItem(item) {
        if (this.state.busy) {
            return;
        }
        this.state.selectedId = item.id;
    }

    craneXForDest(dest) {
        return dest === "temp" ? CRANE_X.temp : CRANE_X[dest] ?? CRANE_X.home;
    }

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

    async placeInBin(binCode) {
        const item = this.selected;
        if (this.state.busy || !item || item.status !== "pending" || item.targetBin !== binCode) {
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
        const next = this.state.items.find((e) => e.status === "pending");
        this.state.selectedId = next ? next.id : this.state.items[this.state.items.length - 1].id;
    }

    reset() {
        if (!this.state.busy) {
            Object.assign(this.state, demoTopPlates());
        }
    }

    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

registry.category("actions").add("crane_yard_operator.plate_put_away_top", PlatePutAwayTop);
