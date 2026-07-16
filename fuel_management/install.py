import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def after_install():
    custom_fields = {
        "Item": [
            {
                "fieldname": "is_fuel",
                "label": "Is Fuel",
                "fieldtype": "Check",
                "insert_after": "item_group"
            },
            {
                "fieldname": "is_lubricant",
                "label": "Is Lubricant",
                "fieldtype": "Check",
                "insert_after": "is_fuel"
            },
            {
                "fieldname": "is_gas",
                "label": "Is Gas",
                "fieldtype": "Check",
                "insert_after": "is_lubricant"
            }
        ],
        "Customer": [
            {
                "fieldname": "fuel_active",
                "label": "Active for Fuel Operations",
                "fieldtype": "Check",
                "insert_after": "customer_group",
                "default": "1"
            },
            {
                "fieldname": "credit_limit",
                "label": "Fuel Credit Limit",
                "fieldtype": "Currency",
                "insert_after": "fuel_active"
            },
            {
                "fieldname": "running_balance",
                "label": "Running Balance",
                "fieldtype": "Currency",
                "insert_after": "credit_limit",
                "read_only": 1
            }
        ],
        "Supplier": [
            {
                "fieldname": "fuel_active",
                "label": "Active for Fuel Operations",
                "fieldtype": "Check",
                "insert_after": "supplier_group",
                "default": "1"
            },
            {
                "fieldname": "credit_limit",
                "label": "Fuel Credit Limit",
                "fieldtype": "Currency",
                "insert_after": "fuel_active"
            },
            {
                "fieldname": "running_balance",
                "label": "Running Balance",
                "fieldtype": "Currency",
                "insert_after": "credit_limit",
                "read_only": 1
            }
        ]
    }
    
    create_custom_fields(custom_fields)
