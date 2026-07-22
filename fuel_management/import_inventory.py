import frappe
import json
import os

def execute():
    app_path = frappe.get_app_path('fuel_management')
    json_path = os.path.join(app_path, 'import_data', 'inventory_data.json')
    
    with open(json_path, 'r') as f:
        data = json.load(f)
        
    for row in data:
        item_group = row['item_group']
        if not frappe.db.exists('Item Group', item_group):
            frappe.get_doc({
                'doctype': 'Item Group',
                'item_group_name': item_group,
                'parent_item_group': 'All Item Groups',
                'is_group': 0
            }).insert(ignore_permissions=True)
            
        item_code = row['item_name'][:140] # ensure it fits
        if not frappe.db.exists('Item', item_code):
            frappe.get_doc({
                'doctype': 'Item',
                'item_code': item_code,
                'item_name': row['item_name'],
                'item_group': item_group,
                'stock_uom': row['stock_uom'],
                'is_stock_item': 1,
                'maintain_stock': 1,
                'valuation_rate': row['purchase_price'],
                'standard_rate': row['purchase_price']
            }).insert(ignore_permissions=True)
            
        # Add Re-order level
        if row['reorder_level'] > 0:
            item_doc = frappe.get_doc('Item', item_code)
            has_reorder = any(r.material_request_type == 'Purchase' for r in item_doc.reorder_levels)
            if not has_reorder:
                item_doc.append('reorder_levels', {
                    'material_request_type': 'Purchase',
                    'reorder_level': row['reorder_level'],
                    'reorder_qty': row['reorder_level'] * 2
                })
                item_doc.save(ignore_permissions=True)
                
        # Create Selling Price
        if row['selling_price'] > 0:
            if not frappe.db.exists('Item Price', {'item_code': item_code, 'price_list': 'Standard Selling'}):
                frappe.get_doc({
                    'doctype': 'Item Price',
                    'item_code': item_code,
                    'price_list': 'Standard Selling',
                    'price_list_rate': row['selling_price']
                }).insert(ignore_permissions=True)
                
    # Create Stock Reconciliation for opening balances
    # We will just draft it so the user can submit it
    stock_items = [r for r in data if r['opening_stock'] > 0]
    if stock_items:
        # Group by item_code to prevent duplicates
        items_dict = {}
        for r in stock_items:
            items_dict[r['item_name'][:140]] = {
                'qty': r['opening_stock'],
                'rate': r['purchase_price']
            }
            
        recon = frappe.get_doc({
            'doctype': 'Stock Reconciliation',
            'purpose': 'Opening Stock',
            'set_posting_time': 1,
        })
        for item_code, vals in items_dict.items():
            recon.append('items', {
                'item_code': item_code,
                'qty': vals['qty'],
                'valuation_rate': vals['rate'],
            })
            
        recon.insert(ignore_permissions=True)
        frappe.db.commit()
        print(f"Imported {len(data)} items and created Stock Reconciliation draft {recon.name}")
