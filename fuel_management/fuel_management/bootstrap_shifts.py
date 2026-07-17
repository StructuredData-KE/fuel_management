import frappe

def execute():
    templates = [
        {"template_name": "Day Shift", "start_time": "06:00:00", "end_time": "18:00:00"},
        {"template_name": "Night Shift", "start_time": "18:00:00", "end_time": "06:00:00"}
    ]
    for t in templates:
        if not frappe.db.exists("Fuel Shift Template", {"template_name": t["template_name"]}):
            doc = frappe.new_doc("Fuel Shift Template")
            doc.template_name = t["template_name"]
            doc.start_time = t["start_time"]
            doc.end_time = t["end_time"]
            doc.insert(ignore_permissions=True)
            print(f"Bootstrapped Template: {t['template_name']}")
    frappe.db.commit()
