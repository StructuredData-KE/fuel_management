import frappe

def add_fields():
    # Fields to add to Shift
    fields = [
        {
            "fieldname": "section_break_grease",
            "label": "Greasing Inventory Tracking",
            "fieldtype": "Section Break",
            "insert_after": "shift_expenses"
        },
        {
            "fieldname": "grease_opening_balance",
            "label": "Grease Opening Balance (KG)",
            "fieldtype": "Float",
            "insert_after": "section_break_grease"
        },
        {
            "fieldname": "grease_top_up",
            "label": "Grease Top-Up (KG)",
            "fieldtype": "Float",
            "insert_after": "grease_opening_balance"
        },
        {
            "fieldname": "grease_closing_balance",
            "label": "Grease Closing Balance (KG)",
            "fieldtype": "Float",
            "insert_after": "grease_top_up"
        },
        {
            "fieldname": "grease_used",
            "label": "Total Grease Used (KG)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "grease_closing_balance"
        },
        {
            "fieldname": "column_break_grease",
            "fieldtype": "Column Break",
            "insert_after": "grease_used"
        },
        {
            "fieldname": "total_greasing_sales",
            "label": "Total Greasing Sales",
            "fieldtype": "Currency",
            "read_only": 1,
            "insert_after": "column_break_grease"
        },
        {
            "fieldname": "greasing_sales",
            "label": "Greasing Sales",
            "fieldtype": "Table",
            "options": "Shift Greasing Sale",
            "insert_after": "total_greasing_sales"
        }
    ]

    doc = frappe.get_doc("DocType", "Shift")
    
    existing_fields = [f.fieldname for f in doc.fields]
    for f in fields:
        if f["fieldname"] not in existing_fields:
            doc.append("fields", f)
            print(f"Added field {f['fieldname']} to Shift")
            
    doc.save()
    frappe.db.commit()
    print("Shift fields updated successfully")
