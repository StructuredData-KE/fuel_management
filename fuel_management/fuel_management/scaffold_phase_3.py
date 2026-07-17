import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def execute():
    # 1. Create Fuel Shift Template Doctype
    if not frappe.db.exists("DocType", "Fuel Shift Template"):
        doc = frappe.new_doc("DocType")
        doc.name = "Fuel Shift Template"
        doc.module = "Fuel Management"
        doc.custom = 0
        doc.istable = 0
        doc.naming_rule = "By fieldname"
        doc.autoname = "field:template_name"
        doc.fields = [
            {
                "fieldname": "template_name",
                "label": "Template Name (e.g. Day Shift)",
                "fieldtype": "Data",
                "reqd": 1,
                "unique": 1,
                "in_list_view": 1
            },
            {
                "fieldname": "start_time",
                "label": "Start Time",
                "fieldtype": "Time",
                "reqd": 1,
                "in_list_view": 1
            },
            {
                "fieldname": "end_time",
                "label": "End Time",
                "fieldtype": "Time",
                "reqd": 1,
                "in_list_view": 1
            }
        ]
        doc.append("permissions", {
            "role": "System Manager",
            "read": 1,
            "write": 1,
            "create": 1,
            "delete": 1
        })
        doc.insert(ignore_permissions=True)
        print("Created Fuel Shift Template Doctype")

    # Bootstrap default templates
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

    # 2. Add new fields to Shift Doctype
    shift_fields = [
        {
            "fieldname": "shift_date",
            "label": "Shift Date",
            "fieldtype": "Date",
            "reqd": 1,
            "default": "Today",
            "insert_after": "head_csa",
            "in_list_view": 1
        },
        {
            "fieldname": "shift_template",
            "label": "Shift Template",
            "fieldtype": "Link",
            "options": "Fuel Shift Template",
            "reqd": 1,
            "insert_after": "shift_date",
            "in_list_view": 1
        },
        {
            "fieldname": "shift_name_display",
            "label": "Shift Name (Display)",
            "fieldtype": "Data",
            "read_only": 1,
            "insert_after": "shift_template",
            "in_list_view": 1
        }
    ]
    
    create_custom_fields({
        "Shift": shift_fields
    })
    
    frappe.db.commit()
    print("Added custom fields to Shift doctype.")
