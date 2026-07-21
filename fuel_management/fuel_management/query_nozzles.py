import frappe
def execute():
    shift = frappe.get_all("Shift", limit=1, order_by="creation desc")[0].name
    doc = frappe.get_doc("Shift", shift)
    print(f"SHIFT: {shift}")
    print("NOZZLES IN SHIFT:")
    for row in doc.pump_meter_readings:
        print(f" - {row.pump_nozzle}")
