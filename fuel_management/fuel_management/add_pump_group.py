import frappe

def execute():
    if not frappe.db.exists("Pump Group", {"group_name": "Lubes & Accessories"}):
        station = frappe.get_all("Fuel Station", limit=1)[0].name
        doc = frappe.new_doc("Pump Group")
        doc.group_name = "Lubes & Accessories"
        doc.station = station
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print("Successfully created Lubes & Accessories Pump Group!")
    else:
        print("Already exists")
