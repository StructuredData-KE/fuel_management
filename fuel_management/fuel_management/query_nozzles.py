import frappe
def execute():
    # Child Table: M-Pesa Till Pump Group
    if not frappe.db.exists("DocType", "M-Pesa Till Pump Group"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "module": "Fuel Management",
            "custom": 0,
            "name": "M-Pesa Till Pump Group",
            "istable": 1,
            "fields": [
                {"fieldname": "pump_group", "label": "Pump Group", "fieldtype": "Link", "options": "Pump Group", "in_list_view": 1, "reqd": 1}
            ]
        })
        doc.insert(ignore_permissions=True)
        print("Created M-Pesa Till Pump Group")

    # Master: M-Pesa Till
    if not frappe.db.exists("DocType", "M-Pesa Till"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "module": "Fuel Management",
            "custom": 0,
            "name": "M-Pesa Till",
            "autoname": "field:till_name",
            "fields": [
                {"fieldname": "till_name", "label": "Till Name", "fieldtype": "Data", "unique": 1, "reqd": 1, "in_list_view": 1},
                {"fieldname": "till_number", "label": "Till Number", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
                {"fieldname": "station", "label": "Fuel Station", "fieldtype": "Link", "options": "Fuel Station", "reqd": 1, "in_list_view": 1},
                {"fieldname": "is_active", "label": "Is Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
                {"fieldname": "pump_groups", "label": "Pump Groups", "fieldtype": "Table", "options": "M-Pesa Till Pump Group"}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert(ignore_permissions=True)
        print("Created M-Pesa Till")


