import frappe
import json
import os

def execute():
    # Force save to generate files
    for dt in ["M-Pesa Till Pump Group", "M-Pesa Till"]:
        if frappe.db.exists("DocType", dt):
            doc = frappe.get_doc("DocType", dt)
            doc.custom = 0
            doc.save(ignore_permissions=True)
    
    frappe.db.commit()
    
    # Read files
    base_path = "/home/frappe/frappe-bench/apps/fuel_management/fuel_management/fuel_management/doctype"
    
    result = {}
    
    for dt_folder in ["m_pesa_till_pump_group", "m_pesa_till"]:
        folder_path = os.path.join(base_path, dt_folder)
        if os.path.exists(folder_path):
            for fname in os.listdir(folder_path):
                fpath = os.path.join(folder_path, fname)
                if os.path.isfile(fpath) and fname != "__pycache__":
                    with open(fpath, "r") as f:
                        result[f"{dt_folder}/{fname}"] = f.read()
                        
    print("===FILES_START===")
    print(json.dumps(result))
    print("===FILES_END===")
