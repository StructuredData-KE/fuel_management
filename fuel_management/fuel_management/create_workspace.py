import frappe
import json

def execute():
    try:
        if frappe.db.exists("Workspace", "Fuel Management"):
            frappe.delete_doc("Workspace", "Fuel Management")
            frappe.db.commit()

        doc = frappe.new_doc("Workspace")
        doc.name = "Fuel Management"
        doc.label = "Fuel Management"
        doc.title = "Fuel Management"
        doc.module = "Fuel Management"
        doc.icon = "indicator-blue"
        doc.is_standard = 1
        doc.public = 1
        
        doc.append("links", {"type": "Link", "label": "Shift", "link_to": "Shift", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Fuel Station", "link_to": "Fuel Station", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Fuel Tank", "link_to": "Fuel Tank", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Pump Group", "link_to": "Pump Group", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Pump Nozzle", "link_to": "Pump Nozzle", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Fleet Card", "link_to": "Fleet Card", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Fuel Management Settings", "link_to": "Fuel Management Settings", "link_type": "DocType"})
        
        doc.content = json.dumps([
            {
                "id": "header-ops",
                "type": "header",
                "data": {"text": "Daily Operations", "level": 4}
            },
            {
                "id": "shortcut-shift",
                "type": "shortcut",
                "data": {"shortcut_name": "Shift", "col": 12}
            },
            {
                "id": "header-setup",
                "type": "header",
                "data": {"text": "Station Configuration", "level": 4}
            },
            {
                "id": "shortcut-station",
                "type": "shortcut",
                "data": {"shortcut_name": "Fuel Station", "col": 4}
            },
            {
                "id": "shortcut-tank",
                "type": "shortcut",
                "data": {"shortcut_name": "Fuel Tank", "col": 4}
            },
            {
                "id": "shortcut-group",
                "type": "shortcut",
                "data": {"shortcut_name": "Pump Group", "col": 4}
            },
            {
                "id": "shortcut-nozzle",
                "type": "shortcut",
                "data": {"shortcut_name": "Pump Nozzle", "col": 4}
            },
            {
                "id": "shortcut-cards",
                "type": "shortcut",
                "data": {"shortcut_name": "Fleet Card", "col": 4}
            },
            {
                "id": "shortcut-settings",
                "type": "shortcut",
                "data": {"shortcut_name": "Fuel Management Settings", "col": 4}
            }
        ])
        
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print("Fuel Management Workspace generated perfectly!")
    except Exception as e:
        import traceback
        print(traceback.format_exc())
