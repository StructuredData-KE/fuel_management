import frappe

def run():
    print("STARTING CLEANUP")
    fuel_items = frappe.get_all("Item", filters={"item_group": ["in", ["FUEL", "FUELS"]]}, pluck="name")
    
    if fuel_items:
        deleted = 0
        stuck_records = frappe.get_all("Shift Inventory Sale", 
            filters={"is_invoice_sale": 1, "item": ["in", fuel_items]}, 
            pluck="name")
        
        for record in stuck_records:
            frappe.db.delete("Shift Inventory Sale", record)
            deleted += 1
            
        frappe.db.commit()
        print(f"DELETED {deleted} FUEL ITEMS FROM INVENTORY SALES")
    else:
        print("NO FUEL ITEMS FOUND")
    
    print("CLEANUP DONE SUCCESSFULLY")
