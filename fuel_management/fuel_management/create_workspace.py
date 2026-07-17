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
        doc.is_standard = 1
        doc.public = 1
        doc.icon = "indicator-blue"
        
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
        doc.append("links", {
            "label": "Reports",
            "type": "Card Break"
        })
        doc.append("links", {
            "label": "Monthly Volume Report",
            "type": "Link",
            "link_type": "Report",
            "link_to": "Monthly Volume Report"
        })
        
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print("Fuel Management Workspace generated perfectly!")
    except Exception as e:
        import traceback
        print(traceback.format_exc())
