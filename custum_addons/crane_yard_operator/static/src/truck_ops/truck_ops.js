/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { CraneYardNav } from "@crane_yard_operator/crane_nav/crane_nav";

const BIN_OPTIONS = ["LA01", "LA02", "LA03", "A1", "A2", "B1", "B2", "TEMP-01", "TEMP-02"];
const TRUCK_TYPES = ["Flatbed", "Trailer", "Container", "Lowbed"];
const PRIORITIES = ["Normal", "High", "Urgent"];

/** Sample registry used for local truck verification (no backend API). */
const KNOWN_TRUCKS = {
    "MH-12-AB-4521": {
        driverName: "Ramesh Patil",
        driverId: "DRV-2041",
        mobile: "9876543210",
        company: "BlueLine Logistics",
        truckType: "Flatbed",
        materialType: "Pipe",
        soNumber: "SO-1001",
        srNumber: "SR-001",
    },
    "MH-14-CD-7788": {
        driverName: "Suresh More",
        driverId: "DRV-1882",
        mobile: "9823012345",
        company: "YardHaul Transport",
        truckType: "Trailer",
        materialType: "Plate",
        soNumber: "SO-1003",
        srNumber: "SR-014",
    },
    "GJ-01-XY-9922": {
        driverName: "Amit Shah",
        driverId: "DRV-3109",
        mobile: "9900998899",
        company: "West Coast Freight",
        truckType: "Container",
        materialType: "Pipe",
        soNumber: "SO-1005",
        srNumber: "SR-022",
    },
};

/** Available stock by material + source bin (for quantity validation). */
const STOCK = {
    Pipe: {
        LA02: { available: 12, items: ["P-101", "P-102", "P-103"], grade: "X52", size: "20–63 mm" },
        LA03: { available: 8, items: ["P-201", "P-202"], grade: "X60", size: "32–50 mm" },
        A1: { available: 5, items: ["P-301"], grade: "X42", size: "25 mm" },
    },
    Plate: {
        A1: { available: 10, items: ["PL-001", "PL-002"], dims: "6000×2000 mm", heat: "H-40" },
        A2: { available: 6, items: ["PL-003", "PL-004"], dims: "8000×2500 mm", heat: "J-55" },
        B1: { available: 4, items: ["PL-005"], dims: "6000×1500 mm", heat: "N-80" },
    },
};

function nowLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyVerifyForm() {
    return {
        truckNumber: "",
        driverName: "",
        driverId: "",
        mobile: "",
        company: "",
        arrivalAt: nowLocal(),
        truckType: "Flatbed",
        materialType: "Pipe",
        soNumber: "",
        srNumber: "",
        status: "pending", // pending | verified | failed
        message: "",
    };
}

function emptyTaskForm() {
    return {
        taskType: "Pick Up",
        materialType: "Pipe",
        soNumber: "",
        srNumber: "",
        sourceBin: "LA02",
        destinationBin: "TRUCK",
        tempLocation: "",
        useTemp: false,
        quantity: 1,
        priority: "Normal",
        pickQty: 1,
        dropQty: 1,
        totalItems: 1,
    };
}

function demoState() {
    return {
        verify: emptyVerifyForm(),
        taskForm: emptyTaskForm(),
        verifiedTruck: null,
        alert: null, // { tone, text }
        viewTaskId: null,
        editingTaskId: null,
        taskSeq: 3,
        tasks: [
            {
                id: "TSK-0001",
                truckNumber: "MH-12-AB-4521",
                driverName: "Ramesh Patil",
                taskType: "Pick Up",
                materialType: "Pipe",
                soNumber: "SO-1001",
                srNumber: "SR-001",
                quantity: 3,
                pickQty: 3,
                dropQty: 3,
                totalItems: 3,
                sourceBin: "LA02",
                destinationBin: "MH-12-AB-4521",
                tempLocation: "",
                priority: "High",
                status: "In Progress",
                itemIds: ["P-101", "P-102", "P-103"],
                itemMeta: "Grade X52 · 20–63 mm",
            },
            {
                id: "TSK-0002",
                truckNumber: "MH-14-CD-7788",
                driverName: "Suresh More",
                taskType: "Put Away",
                materialType: "Plate",
                soNumber: "SO-1003",
                srNumber: "SR-014",
                quantity: 2,
                pickQty: 2,
                dropQty: 2,
                totalItems: 2,
                sourceBin: "MH-14-CD-7788",
                destinationBin: "A2",
                tempLocation: "",
                priority: "Normal",
                status: "Assigned",
                itemIds: ["PL-003", "PL-004"],
                itemMeta: "8000×2500 mm · Heat J-55",
            },
        ],
        awaitingVerification: 2,
    };
}

export class TruckVerificationTaskAllocation extends Component {
    static template = "crane_yard_operator.TruckVerificationTaskAllocation";
    static components = { CraneYardNav };
    static props = ["*"];

    setup() {
        this.binOptions = BIN_OPTIONS;
        this.truckTypes = TRUCK_TYPES;
        this.priorities = PRIORITIES;
        this.state = useState(demoState());
    }

    get navKey() {
        return "truck_ops";
    }

    get isVerified() {
        return this.state.verify.status === "verified" && Boolean(this.state.verifiedTruck);
    }

    get summary() {
        const tasks = this.state.tasks;
        return {
            awaiting: this.state.awaitingVerification,
            verified: this.isVerified ? 1 : 0,
            assigned: tasks.filter((t) => t.status === "Assigned" || t.status === "Pending").length,
            inProgress: tasks.filter((t) => t.status === "In Progress").length,
            completed: tasks.filter((t) => t.status === "Completed").length,
        };
    }

    get stockInfo() {
        const mat = this.state.taskForm.materialType;
        const src = this.state.taskForm.taskType === "Pick Up" ? this.state.taskForm.sourceBin : null;
        if (!src || !STOCK[mat] || !STOCK[mat][src]) {
            return { available: 0, label: "Select a source bin with stock" };
        }
        const s = STOCK[mat][src];
        return {
            available: s.available,
            label:
                mat === "Pipe"
                    ? `${s.available} pipes · ${s.grade} · ${s.size}`
                    : `${s.available} plates · ${s.dims} · ${s.heat}`,
            items: s.items || [],
            meta: mat === "Pipe" ? `Grade ${s.grade} · ${s.size}` : `${s.dims} · Heat ${s.heat}`,
        };
    }

    get locationHints() {
        const f = this.state.taskForm;
        const truck = this.state.verifiedTruck?.truckNumber || "—";
        if (f.taskType === "Pick Up") {
            return {
                sourceLabel: "Source Bin (collect from)",
                destLabel: "Destination (load onto truck)",
                sourceValue: f.sourceBin,
                destValue: truck,
                note: `Driver picks ${f.quantity || 0} ${f.materialType.toLowerCase()}(s) from ${f.sourceBin} and loads onto truck ${truck}.`,
            };
        }
        return {
            sourceLabel: "Source (unload from truck)",
            destLabel: "Destination Bin (store to)",
            sourceValue: truck,
            destValue: f.useTemp && f.tempLocation ? f.tempLocation : f.destinationBin,
            note: f.useTemp
                ? `Unload ${f.quantity || 0} ${f.materialType.toLowerCase()}(s) from ${truck} to temporary ${f.tempLocation}, then move to ${f.destinationBin} when free.`
                : `Unload ${f.quantity || 0} ${f.materialType.toLowerCase()}(s) from ${truck} into bin ${f.destinationBin}.`,
        };
    }

    get viewTask() {
        if (!this.state.viewTaskId) {
            return null;
        }
        return this.state.tasks.find((t) => t.id === this.state.viewTaskId) || null;
    }

    itemIdsLabel(task) {
        return (task?.itemIds || []).join(", ");
    }

    canEdit(task) {
        return task.status === "Assigned" || task.status === "Pending";
    }

    canStart(task) {
        return task.status === "Assigned" || task.status === "Pending";
    }

    canComplete(task) {
        return task.status === "In Progress";
    }

    setAlert(tone, text) {
        this.state.alert = { tone, text };
    }

    clearAlert() {
        this.state.alert = null;
    }

    // ------------------------------------------------------------------
    // Step 1 — Truck verification
    // ------------------------------------------------------------------

    onTruckNumberBlur() {
        const key = (this.state.verify.truckNumber || "").trim().toUpperCase();
        this.state.verify.truckNumber = key;
        const known = KNOWN_TRUCKS[key];
        if (known) {
            Object.assign(this.state.verify, {
                driverName: known.driverName,
                driverId: known.driverId,
                mobile: known.mobile,
                company: known.company,
                truckType: known.truckType,
                materialType: known.materialType,
                soNumber: known.soNumber,
                srNumber: known.srNumber,
            });
        }
    }

    verifyTruck() {
        this.clearAlert();
        const v = this.state.verify;
        const truck = (v.truckNumber || "").trim().toUpperCase();
        if (!truck || !v.driverName || !v.driverId || !v.mobile || !v.soNumber || !v.srNumber) {
            v.status = "failed";
            v.message = "Fill Truck Number, Driver Name, Driver ID, Mobile, SO Number and SR Number.";
            this.setAlert("red", v.message);
            this.state.verifiedTruck = null;
            return;
        }
        if (!/^\d{10}$/.test(String(v.mobile).replace(/\D/g, "").slice(-10))) {
            v.status = "failed";
            v.message = "Driver mobile must be a valid 10-digit number.";
            this.setAlert("red", v.message);
            this.state.verifiedTruck = null;
            return;
        }
        const known = KNOWN_TRUCKS[truck];
        if (!known) {
            v.status = "failed";
            v.message = `Truck ${truck} is not registered in the yard gate list. Verification failed.`;
            this.setAlert("red", v.message);
            this.state.verifiedTruck = null;
            return;
        }
        // Soft match: allow operator-entered values; warn if driver ID mismatches registry.
        if (v.driverId !== known.driverId) {
            v.status = "failed";
            v.message = `Driver ID does not match gate record for ${truck} (expected ${known.driverId}).`;
            this.setAlert("red", v.message);
            this.state.verifiedTruck = null;
            return;
        }

        v.truckNumber = truck;
        v.status = "verified";
        v.message = `Truck ${truck} verified successfully. You can now allocate a task.`;
        this.state.verifiedTruck = {
            truckNumber: truck,
            driverName: v.driverName,
            driverId: v.driverId,
            mobile: v.mobile,
            company: v.company,
            truckType: v.truckType,
            materialType: v.materialType,
            soNumber: v.soNumber,
            srNumber: v.srNumber,
            arrivalAt: v.arrivalAt,
        };
        this.state.taskForm.materialType = v.materialType;
        this.state.taskForm.soNumber = v.soNumber;
        this.state.taskForm.srNumber = v.srNumber;
        if (this.state.awaitingVerification > 0) {
            this.state.awaitingVerification -= 1;
        }
        this._syncTaskLocations();
        this.setAlert("green", v.message);
    }

    clearVerifyForm() {
        Object.assign(this.state.verify, emptyVerifyForm());
        this.state.verifiedTruck = null;
        Object.assign(this.state.taskForm, emptyTaskForm());
        this.clearAlert();
    }

    // ------------------------------------------------------------------
    // Step 2 — Task allocation
    // ------------------------------------------------------------------

    onTaskTypeChange() {
        this._syncTaskLocations();
    }

    onMaterialChange() {
        const mat = this.state.taskForm.materialType;
        const bins = Object.keys(STOCK[mat] || {});
        if (bins.length && this.state.taskForm.taskType === "Pick Up") {
            this.state.taskForm.sourceBin = bins[0];
        }
        if (this.state.taskForm.taskType === "Put Away") {
            this.state.taskForm.destinationBin = bins[0] || "A1";
        }
    }

    _syncTaskLocations() {
        const f = this.state.taskForm;
        const truck = this.state.verifiedTruck?.truckNumber || "TRUCK";
        if (f.taskType === "Pick Up") {
            f.destinationBin = truck;
            if (!STOCK[f.materialType]?.[f.sourceBin]) {
                const bins = Object.keys(STOCK[f.materialType] || {});
                f.sourceBin = bins[0] || "LA02";
            }
        } else {
            f.sourceBin = truck;
            if (!BIN_OPTIONS.includes(f.destinationBin) || f.destinationBin === truck) {
                f.destinationBin = "A1";
            }
        }
        f.pickQty = f.quantity;
        f.dropQty = f.quantity;
        f.totalItems = f.quantity;
    }

    assignTask() {
        this.clearAlert();
        if (!this.isVerified) {
            this.setAlert("red", "Verify the truck before allocating a task.");
            return;
        }
        const f = this.state.taskForm;
        const truck = this.state.verifiedTruck;
        const qty = Number(f.quantity) || 0;
        if (!f.soNumber || !f.srNumber) {
            this.setAlert("red", "Enter Sales Order Number and SR Number.");
            return;
        }
        if (qty < 1) {
            this.setAlert("red", "Quantity must be at least 1.");
            return;
        }
        if (f.taskType === "Pick Up") {
            const stock = STOCK[f.materialType]?.[f.sourceBin];
            if (!stock) {
                this.setAlert("red", `No ${f.materialType.toLowerCase()} stock at source bin ${f.sourceBin}.`);
                return;
            }
            if (qty > stock.available) {
                this.setAlert(
                    "red",
                    `Quantity ${qty} exceeds available ${stock.available} at ${f.sourceBin}.`
                );
                return;
            }
        }
        if (f.taskType === "Put Away" && f.useTemp && !f.tempLocation) {
            this.setAlert("red", "Enter a temporary location or uncheck temporary location.");
            return;
        }

        this.state.taskSeq += 1;
        const id = `TSK-${String(this.state.taskSeq).padStart(4, "0")}`;
        const stock = STOCK[f.materialType]?.[f.sourceBin];
        const itemIds = stock?.items?.slice(0, qty) || [];
        const itemMeta =
            f.materialType === "Pipe"
                ? stock
                    ? `Grade ${stock.grade} · ${stock.size}`
                    : ""
                : stock
                ? `${stock.dims} · Heat ${stock.heat}`
                : "";

        const sourceBin = f.taskType === "Pick Up" ? f.sourceBin : truck.truckNumber;
        const destinationBin = f.taskType === "Pick Up" ? truck.truckNumber : f.destinationBin;
        const tempLocation =
            f.taskType === "Put Away" && f.useTemp && f.tempLocation ? f.tempLocation : "";

        this.state.tasks.unshift({
            id,
            truckNumber: truck.truckNumber,
            driverName: truck.driverName,
            taskType: f.taskType,
            materialType: f.materialType,
            soNumber: f.soNumber,
            srNumber: f.srNumber,
            quantity: qty,
            pickQty: qty,
            dropQty: qty,
            totalItems: qty,
            sourceBin,
            destinationBin,
            tempLocation,
            priority: f.priority,
            status: "Assigned",
            itemIds,
            itemMeta,
        });

        if (f.taskType === "Pick Up" && STOCK[f.materialType]?.[f.sourceBin]) {
            STOCK[f.materialType][f.sourceBin].available = Math.max(
                0,
                STOCK[f.materialType][f.sourceBin].available - qty
            );
        }

        this.setAlert("green", `Task ${id} assigned to ${truck.driverName} / ${truck.truckNumber}.`);
    }

    // ------------------------------------------------------------------
    // Task table actions
    // ------------------------------------------------------------------

    statusClass(status) {
        const map = {
            Pending: "pending",
            Assigned: "assigned",
            "In Progress": "progress",
            Completed: "done",
            Blocked: "blocked",
        };
        return map[status] || "pending";
    }

    openTask(task) {
        this.state.viewTaskId = task.id;
        this.state.editingTaskId = null;
    }

    closeView() {
        this.state.viewTaskId = null;
        this.state.editingTaskId = null;
    }

    editTask(task) {
        if (task.status !== "Assigned" && task.status !== "Pending") {
            this.setAlert("red", "Only tasks that have not started can be edited.");
            return;
        }
        this.state.editingTaskId = task.id;
        this.state.viewTaskId = task.id;
    }

    saveEdit(task) {
        if (Number(task.quantity) < 1) {
            this.setAlert("red", "Quantity must be at least 1.");
            return;
        }
        task.pickQty = Number(task.quantity);
        task.dropQty = Number(task.quantity);
        task.totalItems = Number(task.quantity);
        this.state.editingTaskId = null;
        this.setAlert("green", `Task ${task.id} updated.`);
    }

    startTask(task) {
        if (task.status !== "Assigned" && task.status !== "Pending") {
            this.setAlert("red", `Task ${task.id} cannot be started from status ${task.status}.`);
            return;
        }
        task.status = "In Progress";
        this.setAlert("blue", `Task ${task.id} started.`);
    }

    completeTask(task) {
        if (task.status !== "In Progress") {
            this.setAlert("red", "Start the task before completing it.");
            return;
        }
        task.status = "Completed";
        this.setAlert("green", `Task ${task.id} completed.`);
    }

    blockTask(task) {
        if (task.status === "Completed") {
            return;
        }
        task.status = "Blocked";
        this.setAlert("red", `Task ${task.id} marked blocked.`);
    }
}

registry
    .category("actions")
    .add("crane_yard_operator.truck_ops", TruckVerificationTaskAllocation);
