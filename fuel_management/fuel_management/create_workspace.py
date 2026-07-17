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
        doc.append("links", {
            "label": "Shift Operations",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Shift"
        })
        doc.append("links", {
            "label": "Fleet Card Shifts",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Fleet Card Shift Summary"
        })
        doc.append("links", {
            "label": "Station Setup",
            "type": "Card Break"
        })
        doc.append("links", {
            "label": "Station Opening Balance",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Station Opening Balance"
        })
        doc.append("links", {
            "label": "Fuel Station",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Fuel Station"
        })
        doc.append("links", {
            "label": "Fuel Tank",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Fuel Tank"
        })
        doc.append("links", {
            "label": "Pump Group",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Pump Group"
        })
        doc.append("links", {
            "label": "Pump Nozzle",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Pump Nozzle"
        })
        doc.append("links", {
            "label": "Administration",
            "type": "Card Break"
        })
        doc.append("links", {
            "label": "Staff Liability Ledger",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Staff Liability Ledger"
        })
        doc.append("links", {
            "label": "Fleet Card",
            "type": "Link",
            "link_type": "DocType",
            "link_to": "Fleet Card"
        })
        
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
