/** @odoo-module **/

import { reactive } from "@odoo/owl";

/**
 * Shared pipe-yard bin map used by Pipe Yard Top View / Bin Operation View.
 * Extends existing LA* bin codes already used by pipe picking (LA02 source).
 */

export const PIPE_YARD_LAYOUT = [
    ["BIN-01", "BIN-02", "BIN-03", "BIN-04", "BIN-05", "BIN-06", "BIN-07"],
    ["BIN-08", "BIN-09", "BIN-10", "BIN-11", "BIN-12", "BIN-13", "BIN-14"],
];

const POS = {};
PIPE_YARD_LAYOUT.forEach((row, r) => {
    row.forEach((id, c) => {
        POS[id] = { row: r, col: c };
    });
});

/** Allocated source for current pipe picking demo (matches existing LA02 work). */
export const ALLOCATED_BIN_ID = "BIN-06";
/** Nearby bin used as Temporary Pipe Bin during unstack (layout-adjacent). */
export const TEMP_PIPE_BIN_ID = "BIN-12";

function seedBins() {
    const seed = {
        "BIN-01": { quantity: 28, quality: "API 5L X42", status: "occupied" },
        "BIN-02": { quantity: 14, quality: "API 5L X52", status: "occupied" },
        "BIN-03": { quantity: 0, quality: "", status: "empty" },
        "BIN-04": { quantity: 40, quality: "API 5L X60", status: "occupied" },
        "BIN-05": { quantity: 10, quality: "API 5L X52", status: "occupied" },
        "BIN-06": { quantity: 36, quality: "API 5L X52", status: "allocated" },
        "BIN-07": { quantity: 6, quality: "API 5L X42", status: "occupied" },
        "BIN-08": { quantity: 18, quality: "API 5L X52", status: "occupied" },
        "BIN-09": { quantity: 0, quality: "", status: "empty" },
        "BIN-10": { quantity: 32, quality: "API 5L X65", status: "occupied" },
        "BIN-11": { quantity: 12, quality: "API 5L X52", status: "occupied" },
        "BIN-12": { quantity: 4, quality: "API 5L X52", status: "occupied" },
        "BIN-13": { quantity: 22, quality: "API 5L X60", status: "occupied" },
        "BIN-14": { quantity: 0, quality: "", status: "empty" },
    };
    const bins = {};
    for (const [id, meta] of Object.entries(seed)) {
        const pos = POS[id];
        bins[id] = {
            id,
            number: id,
            row: pos.row,
            col: pos.col,
            quantity: meta.quantity,
            available: meta.quantity,
            quality: meta.quality,
            status: meta.status,
            capacity: 80,
        };
    }
    return bins;
}

export const pipeYardState = reactive({
    bins: seedBins(),
    allocatedBinId: ALLOCATED_BIN_ID,
    tempBinId: TEMP_PIPE_BIN_ID,
    selectedBinId: ALLOCATED_BIN_ID,
    view: "top", // top | bin_ops
});

export function resetPipeYard() {
    Object.assign(pipeYardState, {
        bins: seedBins(),
        allocatedBinId: ALLOCATED_BIN_ID,
        tempBinId: TEMP_PIPE_BIN_ID,
        selectedBinId: ALLOCATED_BIN_ID,
        view: "top",
    });
}

export function enrichBin(id) {
    const bin = pipeYardState.bins[id];
    const isAllocated = id === pipeYardState.allocatedBinId;
    const isTemp = id === pipeYardState.tempBinId;
    const isSelected = id === pipeYardState.selectedBinId;
    let status = bin.status;
    if (isAllocated && status !== "picking") {
        status = "allocated";
    }
    return {
        ...bin,
        status,
        statusLabel: statusLabel(status),
        statusTone: status,
        isAllocated,
        isTemp,
        isSelected,
        free: Math.max(0, bin.capacity - bin.quantity),
    };
}

function statusLabel(status) {
    return (
        {
            occupied: "Occupied",
            empty: "Empty",
            allocated: "Allocated",
            picking: "Picking In Progress",
        }[status] || status
    );
}

export function yardRows() {
    return PIPE_YARD_LAYOUT.map((row, index) => ({
        key: `row-${index}`,
        label: index === 0 ? "North Aisle" : "South Aisle",
        bins: row.map((id) => enrichBin(id)),
    }));
}

export function getNearbyBinIds(binId, count = 4) {
    const pos = POS[binId];
    if (!pos) {
        return [];
    }
    const scored = [];
    for (const [id, p] of Object.entries(POS)) {
        if (id === binId) {
            continue;
        }
        const dRow = Math.abs(p.row - pos.row);
        const dCol = Math.abs(p.col - pos.col);
        scored.push({
            id,
            score: Math.sqrt(dRow * dRow + dCol * dCol),
            dCol,
        });
    }
    scored.sort((a, b) => a.score - b.score || a.dCol - b.dCol || a.id.localeCompare(b.id));
    return scored.slice(0, count).map((x) => x.id);
}

export function operationCluster() {
    const allocatedId = pipeYardState.allocatedBinId;
    const nearbyIds = getNearbyBinIds(allocatedId, 4);
    return {
        allocated: enrichBin(allocatedId),
        nearby: nearbyIds.map((id) => enrichBin(id)),
        all: [allocatedId, ...nearbyIds].map((id) => enrichBin(id)),
    };
}

export function selectBin(binId) {
    pipeYardState.selectedBinId = binId;
}

export function openBinOps() {
    pipeYardState.view = "bin_ops";
    pipeYardState.selectedBinId = pipeYardState.allocatedBinId;
    const bin = pipeYardState.bins[pipeYardState.allocatedBinId];
    if (bin) {
        bin.status = "picking";
    }
}

export function backToTop() {
    pipeYardState.view = "top";
}

/** Keep Temporary Pipe Bin quantity in sync with unstack rack length. */
export function syncTempBinQuantity(qty) {
    const bin = pipeYardState.bins[pipeYardState.tempBinId];
    if (!bin) {
        return;
    }
    // Base stock + pipes currently held from unstack.
    const base = bin._baseQuantity == null ? bin.quantity : bin._baseQuantity;
    if (bin._baseQuantity == null) {
        bin._baseQuantity = bin.quantity;
    }
    bin.quantity = base + Number(qty || 0);
    bin.available = bin.quantity;
    if (bin.quantity > 0 && bin.status === "empty") {
        bin.status = "occupied";
    }
}
