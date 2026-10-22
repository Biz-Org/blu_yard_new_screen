/** @odoo-module **/

import { Component } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

const NAV_GROUPS = [
    {
        key: "truck_ops",
        title: "Truck Operations",
        items: [
            { key: "truck_ops", label: "Verify & Allocate", icon: "fa-clipboard", action: "crane_yard_operator.action_truck_ops" },
        ],
    },
    {
        key: "put_away",
        title: "Put Away",
        items: [
            { key: "plate_put_away", label: "Plate Put Away", icon: "fa-th-large", action: "crane_yard_operator.action_plate_put_away" },
            { key: "plate_put_away_top", label: "Plate Put Away (Top View)", icon: "fa-square", action: "crane_yard_operator.action_plate_put_away_top" },
            { key: "pipe_put_away", label: "Pipe Put Away", icon: "fa-circle-o", action: "crane_yard_operator.action_pipe_put_away" },
        ],
    },
    {
        key: "plate",
        title: "Plate Picking",
        items: [
            { key: "move_plates", label: "Move Upper Plates", icon: "fa-exchange", action: "crane_yard_operator.action_move_plates" },
            { key: "drop_truck", label: "Drop to Conveyor", icon: "fa-ellipsis-h", action: "crane_yard_operator.action_drop_truck" },
            { key: "return_plates", label: "Return Temporary Plates", icon: "fa-reply", action: "crane_yard_operator.action_return_plates" },
        ],
    },
    {
        key: "pipe",
        title: "Pipe Picking & Dropping",
        items: [
            { key: "pipe_unstack", label: "Unstack Upper Pipes", icon: "fa-arrow-up", action: "crane_yard_operator.action_pipe_unstack" },
            { key: "pipe_drop", label: "Pick & Drop to Truck", icon: "fa-truck", action: "crane_yard_operator.action_pipe_drop" },
            { key: "pipe_return", label: "Return Temporary Pipes", icon: "fa-reply", action: "crane_yard_operator.action_pipe_return" },
        ],
    },
];

export class CraneYardNav extends Component {
    static template = "crane_yard_operator.CraneYardNav";
    static props = { active: String, disabled: { type: Boolean, optional: true } };

    setup() {
        this.groups = NAV_GROUPS;
        this.actionService = useService("action");
    }

    open(item) {
        if (item.key !== this.props.active && !this.props.disabled) {
            this.actionService.doAction(item.action, { clearBreadcrumbs: true });
        }
    }
}
