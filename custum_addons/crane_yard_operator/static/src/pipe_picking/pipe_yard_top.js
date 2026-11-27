/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { CraneYardNav } from "@crane_yard_operator/crane_nav/crane_nav";
import {
    pipeYardState,
    resetPipeYard,
    yardRows,
    selectBin,
    openBinOps,
    backToTop,
    operationCluster,
    ALLOCATED_BIN_ID,
} from "@crane_yard_operator/pipe_picking/pipe_yard_data";

const UNSTACK_ACTION = "crane_yard_operator.action_pipe_unstack";

export class PipeYardTopView extends Component {
    static template = "crane_yard_operator.PipeYardTopView";
    static components = { CraneYardNav };
    static props = ["*"];

    setup() {
        this.state = useState(pipeYardState);
        this.actionService = useService("action");
    }

    get navKey() {
        return "pipe_yard_top";
    }

    get isTopView() {
        return this.state.view === "top";
    }

    get rows() {
        return yardRows();
    }

    get cluster() {
        return operationCluster();
    }

    get allocatedId() {
        return this.state.allocatedBinId || ALLOCATED_BIN_ID;
    }

    onBinClick(binId) {
        selectBin(binId);
        if (binId === this.allocatedId) {
            openBinOps();
        }
    }

    openAllocatedOps() {
        selectBin(this.allocatedId);
        openBinOps();
    }

    goTop() {
        backToTop();
    }

    openUnstack() {
        openBinOps();
        this.actionService.doAction(UNSTACK_ACTION);
    }

    reset() {
        resetPipeYard();
    }
}

registry.category("actions").add("crane_yard_operator.pipe_yard_top", PipeYardTopView);
