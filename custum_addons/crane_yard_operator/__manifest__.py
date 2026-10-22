# -*- coding: utf-8 -*-
{
    'name': 'Crane Yard Operator',
    'version': '1.2.1',
    'summary': 'Crane operator screens for truck verification, put away, plate picking and pipe picking',
    'category': 'Inventory/Inventory',
    'depends': ['web'],
    'data': [
        'views/crane_yard_operator_menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'crane_yard_operator/static/src/**/*',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
