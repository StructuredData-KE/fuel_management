import frappe
def execute():
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

