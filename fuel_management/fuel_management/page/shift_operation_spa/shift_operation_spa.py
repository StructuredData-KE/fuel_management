import frappe
from frappe.utils import getdate, nowdate, flt

@frappe.whitelist()
def get_debtors_data(station=None):
    from fuel_management.fuel_management.api import get_debtors_data as api_get_debtors_data
    return api_get_debtors_data(station=station)
    
    # 1. Fetch ALL registered customers from tabCustomer
    all_customers = frappe.db.get_all('Customer', 
        fields=['name', 'customer_name', 'credit_limit', 'email_id', 'mobile_no', 'primary_address', 'disabled'],
        order_by='customer_name asc'
    )
    
    # 2. Invoices from Shift Invoices
    invoices = frappe.db.sql("""
        SELECT 
            si.customer, 
            SUM(si.amount) as total_invoiced
        FROM 
            `tabShift Invoice` si
        JOIN 
            `tabShift` s ON si.parent = s.name
        WHERE 
            s.docstatus < 2
        GROUP BY 
            si.customer
    """, as_dict=True)
    
    # 3. Payments from Customer Payment
    payments = frappe.db.sql("""
        SELECT 
            customer, 
            SUM(amount) as total_paid, 
            MAX(date) as last_payment_date
        FROM 
            `tabCustomer Payment`
        WHERE 
            docstatus < 2
        GROUP BY 
            customer
    """, as_dict=True)
    
    # 4. GL balances (excluding Shift Closure JEs)
    gl_balances = frappe.db.sql("""
        SELECT 
            party as customer,
            SUM(debit) as total_debit,
            SUM(credit) as total_credit
        FROM `tabGL Entry`
        WHERE party_type = 'Customer' AND is_cancelled = 0
        AND (remarks IS NULL OR (remarks NOT LIKE '%%Shift Closure Accounting%%' AND remarks NOT LIKE '%%Customer Payment Reference%%'))
        GROUP BY party
    """, as_dict=True)
    
    customer_map = {c.name: c for c in all_customers}
    payment_map = {p.customer: p for p in payments}
    invoice_map = {i.customer: i for i in invoices}
    gl_map = {g.customer: flt(g.total_debit) - flt(g.total_credit) for g in gl_balances}
    
    all_cust_keys = set(customer_map.keys())
    for inv in invoices:
        if inv.customer:
            all_cust_keys.add(inv.customer)
    for pay in payments:
        if pay.customer:
            all_cust_keys.add(pay.customer)
    for gl in gl_balances:
        if gl.customer:
            all_cust_keys.add(gl.customer)
            
    results = []
    
    for cust in all_cust_keys:
        c_info = customer_map.get(cust, {})
        c_name = c_info.get('customer_name') if isinstance(c_info, dict) else cust
        credit_limit = flt(c_info.get('credit_limit') or 0.0) if isinstance(c_info, dict) else 0.0
        
        inv = invoice_map.get(cust, {})
        pay = payment_map.get(cust, {})
        opening_balance = gl_map.get(cust, 0.0)
        
        total_invoiced = flt(inv.get('total_invoiced', 0))
        total_paid = flt(pay.get('total_paid', 0))
        last_payment_date = pay.get('last_payment_date', None)
        
        balance = opening_balance + total_invoiced - total_paid
        
        status = 'Safe'
        if credit_limit > 0:
            if balance >= credit_limit:
                status = 'Overdue'
            elif balance >= 0.8 * credit_limit:
                status = 'Near Limit'
        elif balance > 0:
            status = 'Near Limit'
        elif balance < 0:
            status = 'In Advance'
        else:
            status = 'Settled'
            
        results.append({
            'id': cust,
            'name': c_name or cust,
            'fleet_id': cust, 
            'last_payment_date': str(last_payment_date) if last_payment_date else '',
            'total_invoiced': round(total_invoiced, 2),
            'total_paid': round(total_paid, 2),
            'opening_balance': round(opening_balance, 2),
            'balance': round(balance, 2),
            'status': status,
            'credit_limit': credit_limit
        })
        
    results.sort(key=lambda x: (x['balance'] == 0, -x['balance'], x['name']))
    return results

@frappe.whitelist()
def get_customer_transactions(customer_id=None, customer=None, **kwargs):
    cust_id = customer_id or customer or kwargs.get('customer') or kwargs.get('customer_id')
    if not cust_id:
        return []
    
    # 1. GL entries
    gl_entries = frappe.db.sql("""
        SELECT 
            posting_date as date,
            voucher_type as ref_type,
            voucher_no as reference,
            remarks as description,
            debit,
            credit
        FROM `tabGL Entry`
        WHERE party_type = 'Customer' 
        AND party = %s 
        AND is_cancelled = 0
        AND (remarks IS NULL OR (remarks NOT LIKE '%%Shift Closure Accounting%%' AND remarks NOT LIKE '%%Customer Payment Reference%%'))
        ORDER BY posting_date ASC, creation ASC
    """, cust_id, as_dict=True)
    
    # 2. Shift Invoices
    shift_invoices = frappe.db.sql("""
        SELECT 
            s.shift_date as date,
            si.name as reference,
            'Shift Invoice' as ref_type,
            si.vehicle_registration,
            si.purchase_order,
            si.item,
            si.quantity,
            si.rate,
            si.entry_number,
            si.csa,
            IFNULL(e.employee_name, si.csa) as csa_name,
            si.amount as debit,
            0.0 as credit,
            si.creation
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        LEFT JOIN `tabEmployee` e ON (si.csa = e.name OR si.csa = e.user_id)
        WHERE si.customer = %s AND s.docstatus < 2
        ORDER BY s.shift_date ASC, si.creation ASC
    """, cust_id, as_dict=True)
    
    # 3. Customer Payments
    payments = frappe.db.sql("""
        SELECT 
            p.date,
            p.name as reference,
            'Customer Payment' as ref_type,
            p.mode_of_payment,
            p.trans_no,
            p.csa,
            IFNULL(e.employee_name, p.csa) as csa_name,
            p.memo,
            0.0 as debit,
            p.amount as credit,
            p.creation
        FROM `tabCustomer Payment` p
        LEFT JOIN `tabEmployee` e ON (p.csa = e.name OR p.csa = e.user_id)
        WHERE p.customer = %s AND p.docstatus < 2
        ORDER BY p.date ASC, p.creation ASC
    """, cust_id, as_dict=True)
    
    all_raw = []
    
    for g in gl_entries:
        all_raw.append({
            'date': str(g.date),
            'ref_type': g.ref_type or 'GL Entry',
            'voucher_type': g.ref_type or 'GL Entry',
            'reference': g.reference or '',
            'reference_no': g.reference or '',
            'description': g.description or g.reference or 'General Ledger Entry',
            'type': 'GL Entry',
            'debit': flt(g.debit),
            'credit': flt(g.credit),
            'sort_key': f"{g.date}_1"
        })
        
    for si in shift_invoices:
        desc_parts = []
        if si.vehicle_registration:
            desc_parts.append(f"Veh: {si.vehicle_registration}")
        if si.item:
            qty_str = f"{flt(si.quantity):,.1f}L" if si.quantity else ""
            rate_str = f"@ KES {flt(si.rate):,.2f}" if si.rate else ""
            desc_parts.append(f"{si.item} ({qty_str} {rate_str})".strip())
        if si.purchase_order:
            desc_parts.append(f"PO: {si.purchase_order}")
        csa_display = si.csa_name or si.csa or ''
        if csa_display:
            desc_parts.append(f"CSA: {csa_display}")
            
        desc = " | ".join(desc_parts) if desc_parts else "Fuel Sale Invoice"
        
        all_raw.append({
            'date': str(si.date),
            'ref_type': 'Shift Invoice',
            'voucher_type': 'Shift Invoice',
            'reference': si.reference,
            'reference_no': si.entry_number or si.reference,
            'entry_number': si.entry_number or '',
            'vehicle_registration': si.vehicle_registration or '',
            'item': si.item or '',
            'quantity': flt(si.quantity),
            'rate': flt(si.rate),
            'csa': csa_display,
            'csa_id': si.csa or '',
            'purchase_order': si.purchase_order or '',
            'description': desc,
            'type': 'Invoice',
            'debit': flt(si.debit),
            'credit': 0.0,
            'sort_key': f"{si.date}_2"
        })
        
    for p in payments:
        desc_parts = []
        if p.mode_of_payment:
            desc_parts.append(f"Mode: {p.mode_of_payment}")
        if p.trans_no:
            desc_parts.append(f"Ref: {p.trans_no}")
        if p.memo:
            desc_parts.append(f"Memo: {p.memo}")
        csa_display = p.csa_name or p.csa or ''
        if csa_display:
            desc_parts.append(f"Received By: {csa_display}")
            
        desc = " | ".join(desc_parts) if desc_parts else "Payment Received"
        
        all_raw.append({
            'date': str(p.date),
            'ref_type': 'Customer Payment',
            'voucher_type': 'Customer Payment',
            'reference': p.reference,
            'reference_no': p.trans_no or p.reference,
            'trans_no': p.trans_no or '',
            'mode_of_payment': p.mode_of_payment or '',
            'csa': csa_display,
            'csa_id': p.csa or '',
            'memo': p.memo or '',
            'description': desc,
            'type': 'Payment',
            'debit': 0.0,
            'credit': flt(p.credit),
            'sort_key': f"{p.date}_3"
        })
        
    all_raw.sort(key=lambda x: x['sort_key'])
    return all_raw

@frappe.whitelist()
def get_detailed_customer_statement(customer_id=None, customer=None, start_date=None, end_date=None, **kwargs):
    cust_id = customer_id or customer or kwargs.get('customer') or kwargs.get('customer_id')
    if not cust_id:
        return {}
        
    if not start_date or not end_date:
        today = getdate(nowdate())
        if not start_date:
            start_date = f"{today.year}-{today.month:02d}-01"
        if not end_date:
            end_date = str(today)
            
    # 1. Customer metadata
    cust_doc = frappe.db.get_value("Customer", cust_id, 
        ["name", "customer_name", "tax_id", "email_id", "mobile_no", "primary_address", "credit_limit"], 
        as_dict=True
    ) or {"name": cust_id, "customer_name": cust_id}
    
    all_raw = get_customer_transactions(cust_id)
    
    opening_bal = 0.0
    period_txns = []
    
    for t in all_raw:
        t_date = t['date']
        if t_date < start_date:
            opening_bal += (t['debit'] - t['credit'])
        elif start_date <= t_date <= end_date:
            period_txns.append(t)
            
    running = opening_bal
    tot_debits = 0.0
    tot_credits = 0.0
    tot_litres = 0.0
    
    for pt in period_txns:
        running += (pt['debit'] - pt['credit'])
        pt['running_balance'] = round(running, 2)
        pt['balance'] = round(running, 2)
        tot_debits += pt['debit']
        tot_credits += pt['credit']
        if pt.get('quantity') and flt(pt.get('quantity')) > 0:
            tot_litres += flt(pt['quantity'])
        
    return {
        'customer': {
            'id': cust_id,
            'name': cust_doc.get('customer_name') or cust_id,
            'tax_id': cust_doc.get('tax_id') or '',
            'email': cust_doc.get('email_id') or '',
            'phone': cust_doc.get('mobile_no') or '',
            'address': cust_doc.get('primary_address') or '',
            'credit_limit': flt(cust_doc.get('credit_limit') or 0.0)
        },
        'start_date': start_date,
        'end_date': end_date,
        'opening_balance': round(opening_bal, 2),
        'period_debits': round(tot_debits, 2),
        'period_invoices': round(tot_debits, 2),
        'period_credits': round(tot_credits, 2),
        'period_payments': round(tot_credits, 2),
        'period_net': round(tot_debits - tot_credits, 2),
        'total_litres': round(tot_litres, 2),
        'closing_balance': round(running, 2),
        'transactions': period_txns
    }

@frappe.whitelist()
def get_debtors_aging_analysis(as_of_date=None, station=None, **kwargs):
    from fuel_management.fuel_management.api import get_debtors_aging_analysis as api_aging
    return api_aging(as_of_date=as_of_date, station=station, **kwargs)

@frappe.whitelist()
def get_daily_sales_breakdown(station=None, from_date=None, to_date=None, month=None, year=None):
    from fuel_management.fuel_management.api import get_daily_sales_breakdown as _get_dsb
    return _get_dsb(station=station, from_date=from_date, to_date=to_date, month=month, year=year)

@frappe.whitelist()
def get_monthly_volume_analysis(station=None, from_date=None, to_date=None, month=None, year=None):
    from fuel_management.fuel_management.api import get_monthly_volume_analysis as _get_mva
    return _get_mva(station=station, from_date=from_date, to_date=to_date, month=month, year=year)



