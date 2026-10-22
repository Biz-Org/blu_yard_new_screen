/** @odoo-module **/

import { Component } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { DropToTruck, PlatePicking } from "@crane_yard_operator/plate_picking/plate_picking";
import { PipeDropToTruck, PipePicking } from "@crane_yard_operator/pipe_picking/pipe_picking";

/**
 * Older menus (module custum_addons) all use one client-action tag and
 * choose the screen with context crane_screen.
 */
const SCREENS = {
    move_upper_plates: PlatePicking,
    drop_to_truck: DropToTruck,
    unstack_pipes: PipePicking,
    pick_drop_truck: PipeDropToTruck,
};

export class LegacyYardAction extends Component {
    static template = "crane_yard_operator.LegacyYardAction";
    static props = ["*"];

    get Screen() {
        const screen = this.props.action?.context?.crane_screen || "move_upper_plates";
        return SCREENS[screen] || PlatePicking;
    }
}

registry.category("actions").add("yard_move_upper_plates", LegacyYardAction);
