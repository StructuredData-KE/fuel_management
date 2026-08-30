import frappe

@frappe.whitelist()
def setup_mpesa_mapping():
    # 1. Add bank_name to M-Pesa Till
    try:
        mpesa_till = frappe.get_doc("Customize Form", "M-Pesa Till")
        
        # Check if field already exists
        exists = any(f.fieldname == "bank_name" for f in mpesa_till.fields)
        if not exists:
            mpesa_till.append("fields", {
                "fieldname": "bank_name",
                "label": "Bank Name",
                "fieldtype": "Data",
                "insert_after": "default_account"
            })
            mpesa_till.save()
            print("Added bank_name to M-Pesa Till")
    except Exception as e:
        print(f"Error adding to M-Pesa Till: {e}")

    # 2. Add bank_name to Shift M-pesa Payment
    try:
        shift_mpesa = frappe.get_doc("Customize Form", "Shift M-pesa Payment")
        exists = any(f.fieldname == "bank_name" for f in shift_mpesa.fields)
        if not exists:
            shift_mpesa.append("fields", {
                "fieldname": "bank_name",
                "label": "Bank Name",
                "fieldtype": "Data",
                "fetch_from": "mpesa_till.bank_name",
                "insert_after": "amount"
            })
            shift_mpesa.save()
            print("Added bank_name to Shift M-pesa Payment")
    except Exception as e:
        print(f"Error adding to Shift M-pesa Payment: {e}")

    # 3. Update existing tills
    try:
        tills = frappe.get_all("M-Pesa Till", fields=["name", "till_name"])
        for till in tills:
            if "Pump" in till.till_name:
                frappe.db.set_value("M-Pesa Till", till.name, "bank_name", "Equity")
            elif "Lubes" in till.till_name:
                frappe.db.set_value("M-Pesa Till", till.name, "bank_name", "Rubis")
        frappe.db.commit()
        print("Updated existing tills successfully")
    except Exception as e:
        print(f"Error updating tills: {e}")

    return "Success"
