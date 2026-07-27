import frappe

def create_doctypes():
    # 1. Grease Vehicle Type
    if not frappe.db.exists("DocType", "Grease Vehicle Type"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Grease Vehicle Type",
            "module": "Fuel Management",
            "custom": 1,
            "autoname": "field:vehicle_type",
            "fields": [
                {
                    "fieldname": "vehicle_type",
                    "fieldtype": "Data",
                    "label": "Vehicle Type",
                    "reqd": 1,
                    "unique": 1
                },
                {
                    "fieldname": "greasing_price",
                    "fieldtype": "Currency",
                    "label": "Greasing Price",
                    "reqd": 1,
                    "default": "0"
                }
            ],
            "permissions": [
                {
                    "role": "System Manager",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1
                }
            ]
        })
        doc.insert()
        print("Created Grease Vehicle Type")

    # 2. Shift Greasing Sale
    if not frappe.db.exists("DocType", "Shift Greasing Sale"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Shift Greasing Sale",
            "module": "Fuel Management",
            "custom": 1,
            "istable": 1,
            "editable_grid": 1,
            "fields": [
                {
                    "fieldname": "csa",
                    "fieldtype": "Link",
                    "label": "CSA in Charge",
                    "options": "User",
                    "in_list_view": 1,
                    "reqd": 1
                },
                {
                    "fieldname": "vehicle_type",
                    "fieldtype": "Link",
                    "label": "Vehicle Type",
                    "options": "Grease Vehicle Type",
                    "in_list_view": 1,
                    "reqd": 1
                },
                {
                    "fieldname": "number_of_vehicles",
                    "fieldtype": "Int",
                    "label": "Number of Vehicles",
                    "in_list_view": 1,
                    "reqd": 1,
                    "default": "1"
                },
                {
                    "fieldname": "amount_per_vehicle",
                    "fieldtype": "Currency",
                    "label": "Amount per Vehicle",
                    "in_list_view": 1,
                    "reqd": 1
                },
                {
                    "fieldname": "total_amount",
                    "fieldtype": "Currency",
                    "label": "Total Greasing Amount",
                    "in_list_view": 1,
                    "read_only": 1
                }
            ]
        })
        doc.insert()
        print("Created Shift Greasing Sale")
        
    frappe.db.commit()
