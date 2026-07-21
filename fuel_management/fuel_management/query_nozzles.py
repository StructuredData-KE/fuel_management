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

    # Create Mock Till
    if not frappe.db.exists("M-Pesa Till", "Main Till 123456"):
        doc = frappe.get_doc({
            "doctype": "M-Pesa Till",
            "till_name": "Main Till 123456",
            "till_number": "123456",
            "station": "RUBIS POA PLACE"
        })
        doc.insert(ignore_permissions=True)
    
    active_shifts = frappe.get_all("Shift", filters={"status": "Open"}, pluck="name")
    for s in active_shifts: frappe.delete_doc("Shift", s, ignore_permissions=True, force=1)
    
    shift = frappe.get_doc({
        "doctype": "Shift",
        "shift_date": "2026-07-21",
        "shift_template": "Day Shift",
        "station": "RUBIS POA PLACE",
        "head_csa": "Administrator",
        "status": "Open",
        "start_time": "2026-07-21 10:09:58",
        "assigned_csas": [{"csa":"antony@gmail.com","pump_group":"PUMP 1"}]
    })
    shift.insert(ignore_permissions=True)
    print(f"CREATED: {shift.name}")
    print("NOZZLES:")
    for row in shift.pump_meter_readings:
        print(f" - {row.pump_nozzle}")
    print("MPESA TILLS:")
    for row in shift.mpesa_payments:
        print(f" - {row.mpesa_till} (Opening: {row.opening_balance})")
