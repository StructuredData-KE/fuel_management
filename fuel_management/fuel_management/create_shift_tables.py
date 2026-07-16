import frappe

def create_child_table(name, fields):
    if frappe.db.exists("DocType", name):
        print(f"DocType {name} already exists. Skipping.")
        return
        
    doc = frappe.new_doc("DocType")
    doc.name = name
    doc.module = "Fuel Management"
    doc.custom = 0
    doc.istable = 1
    doc.naming_rule = "Random"
    
    for f in fields:
        doc.append("fields", f)
        
    doc.insert(ignore_permissions=True)
    print(f"Created {name}")

def execute():
    try:
        create_child_table("Shift Inventory Sale", [
            {"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": "Item", "in_list_view": 1, "reqd": 1},
            {"fieldname": "quantity", "label": "Quantity", "fieldtype": "Float", "in_list_view": 1, "reqd": 1},
            {"fieldname": "selling_price", "label": "Selling Price", "fieldtype": "Currency", "in_list_view": 1},
            {"fieldname": "amount", "label": "Total Amount", "fieldtype": "Currency", "in_list_view": 1, "read_only": 1}
        ])
        
        create_child_table("Shift M-Pesa Payment", [
            {"fieldname": "transaction_id", "label": "Transaction ID", "fieldtype": "Data", "in_list_view": 1, "reqd": 1},
            {"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1, "reqd": 1}
        ])

        create_child_table("Shift Card Payment", [
            {"fieldname": "card_type", "label": "Card Type", "fieldtype": "Select", "options": "Visa\nMastercard\nFleet Card", "in_list_view": 1, "reqd": 1},
            {"fieldname": "receipt_no", "label": "Receipt No", "fieldtype": "Data", "in_list_view": 1},
            {"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1, "reqd": 1}
        ])

        create_child_table("Shift Invoice", [
            {"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer", "in_list_view": 1, "reqd": 1},
            {"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1, "reqd": 1}
        ])

        create_child_table("Shift Procurement", [
            {"fieldname": "supplier", "label": "Supplier", "fieldtype": "Link", "options": "Supplier", "in_list_view": 1, "reqd": 1},
            {"fieldname": "item", "label": "Item", "fieldtype": "Link", "options": "Item", "in_list_view": 1},
            {"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1, "reqd": 1}
        ])

        create_child_table("Shift Expense", [
            {"fieldname": "expense_type", "label": "Expense Type", "fieldtype": "Data", "in_list_view": 1, "reqd": 1},
            {"fieldname": "amount", "label": "Amount", "fieldtype": "Currency", "in_list_view": 1, "reqd": 1}
        ])

        create_child_table("Shift Return To Tank", [
            {"fieldname": "pump_nozzle", "label": "Pump Nozzle", "fieldtype": "Link", "options": "Pump Nozzle", "in_list_view": 1, "reqd": 1},
            {"fieldname": "fuel_tank", "label": "Fuel Tank", "fieldtype": "Link", "options": "Fuel Tank", "in_list_view": 1},
            {"fieldname": "quantity", "label": "Quantity (Liters)", "fieldtype": "Float", "in_list_view": 1, "reqd": 1}
        ])
        
        shift = frappe.get_doc("DocType", "Shift")
        
        def has_field(fieldname):
            return any(f.fieldname == fieldname for f in shift.fields)

        if not has_field("section_break_inventory_sales"):
            shift.append("fields", {"fieldname": "section_break_inventory_sales", "label": "Inventory Sales (Dry Stock)", "fieldtype": "Section Break"})
            shift.append("fields", {"fieldname": "inventory_sales", "label": "Inventory Sales", "fieldtype": "Table", "options": "Shift Inventory Sale"})

        if not has_field("section_break_collections"):
            shift.append("fields", {"fieldname": "section_break_collections", "label": "Payment Collections", "fieldtype": "Section Break"})
            shift.append("fields", {"fieldname": "mpesa_payments", "label": "M-Pesa Payments", "fieldtype": "Table", "options": "Shift M-Pesa Payment"})
            shift.append("fields", {"fieldname": "card_payments", "label": "Card Payments", "fieldtype": "Table", "options": "Shift Card Payment"})
            shift.append("fields", {"fieldname": "invoices", "label": "Invoices (Credit)", "fieldtype": "Table", "options": "Shift Invoice"})

        if not has_field("section_break_expenses"):
            shift.append("fields", {"fieldname": "section_break_expenses", "label": "Expenses & Operations", "fieldtype": "Section Break"})
            shift.append("fields", {"fieldname": "shift_expenses", "label": "Shift Expenses", "fieldtype": "Table", "options": "Shift Expense"})
            shift.append("fields", {"fieldname": "procurement", "label": "Procurement", "fieldtype": "Table", "options": "Shift Procurement"})
            shift.append("fields", {"fieldname": "return_to_tank", "label": "Return To Tank", "fieldtype": "Table", "options": "Shift Return To Tank"})

        if not has_field("section_break_reconciliation"):
            shift.append("fields", {"fieldname": "section_break_reconciliation", "label": "Cash Reconciliation", "fieldtype": "Section Break"})
            shift.append("fields", {"fieldname": "expected_cash", "label": "Expected Cash", "fieldtype": "Currency", "read_only": 1})
            shift.append("fields", {"fieldname": "actual_cash", "label": "Actual Cash Counted", "fieldtype": "Currency"})
            shift.append("fields", {"fieldname": "cash_variance", "label": "Cash Variance", "fieldtype": "Currency", "read_only": 1})

        shift.save()
        frappe.db.commit()
        print("Shift Doctype updated successfully.")

    except Exception as e:
        import traceback
        print(traceback.format_exc())
