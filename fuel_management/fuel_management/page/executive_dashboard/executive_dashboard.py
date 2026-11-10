import frappe
from frappe.utils import today, getdate, flt, formatdate, now_datetime
import json

@frappe.whitelist()
def get_dashboard_summary(from_date=None, to_date=None, station=None):
    """Returns a high-level summary of the dashboard metrics."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = to_date
    
    station_shift_clause = ""
    station_fs_clause = ""
    station_params = []
    if station and station not in ("ALL", "All Stations", ""):
        station_shift_clause = " AND station = %s"
        station_fs_clause = " AND fs.station = %s"
        station_params.append(station)

    # Financial Overview
    # 1. Total Sales Today (or selected period)
    total_sales_today = frappe.db.sql(f"""
        SELECT SUM(expected_cash + expected_dry_stock_cash) 
        FROM `tabShift` 
        WHERE docstatus < 2 AND DATE(shift_date) >= %s AND DATE(shift_date) <= %s {station_shift_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    # 2. Collections Split
    # We will sum M-Pesa payments
    mpesa_total = frappe.db.sql(f"""
        SELECT SUM(mp.amount) 
        FROM `tabShift M-Pesa Payment` mp 
        INNER JOIN `tabShift` fs ON mp.parent = fs.name 
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s {station_fs_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    card_total = frappe.db.sql(f"""
        SELECT SUM(cp.amount) 
        FROM `tabShift Card Payment` cp 
        INNER JOIN `tabShift` fs ON cp.parent = fs.name 
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s {station_fs_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    cash_total = frappe.db.sql(f"""
        SELECT SUM(actual_cash + actual_dry_stock_cash) 
        FROM `tabShift` 
        WHERE docstatus < 2 AND DATE(shift_date) >= %s AND DATE(shift_date) <= %s {station_shift_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    collections = {
        "mpesa": float(mpesa_total),
        "card": float(card_total),
        "cash": float(cash_total),
        "total": float(mpesa_total + card_total + cash_total)
    }

    # 3. Variance and Reconciliations
    shift_variance = frappe.db.sql(f"""
        SELECT SUM(st.variance)
        FROM `tabDip Stick Reading` st
        INNER JOIN `tabShift` fs ON st.parent = fs.name
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s {station_fs_clause}
    """, [from_date, to_date] + station_params)[0][0] or 0.0

    # Inventory / Assets
    # Tank Levels from latest physical dip stick readings
    tank_data = get_tank_levels(station=station if (station and station not in ("ALL", "All Stations", "")) else None)
    tank_levels = tank_data.get("tanks", [])

    # Alerts
    alerts = []
    
    # High Variance Alert
    if abs(shift_variance) > 50:
        st_label = f" ({station})" if station and station not in ("ALL", "All Stations", "") else ""
        alerts.append({
            "title": f"High Fuel Variance{st_label}",
            "desc": f"Total station variance today is {shift_variance:.1f} Liters.",
            "type": "danger",
            "icon": "water_drop"
        })

    # Critical Low Tank Alert
    for t in tank_levels:
        if t.get("status") == "critical":
            alerts.append({
                "title": f"Low Fuel: {t.get('tank_name')}",
                "desc": f"{t.get('tank_name')} is critically low at {t.get('percentage')}% ({flt(t.get('last_dip_volume')):,.0f} L / {flt(t.get('capacity')):,.0f} L). Order replenishment.",
                "type": "danger",
                "icon": "warning"
            })

    # Holding Account Balance
    holding_cond = ""
    holding_args = []
    if station and station not in ("ALL", "All Stations", ""):
        holding_cond = " AND name = %s"
        holding_args.append(station)

    holding_accounts = frappe.db.sql(f"""
        SELECT DISTINCT top_up_holding_account 
        FROM `tabFuel Station` 
        WHERE top_up_holding_account IS NOT NULL AND top_up_holding_account != '' {holding_cond}
    """, holding_args, pluck=True)

    holding_balance = 0.0
    if holding_accounts:
        from erpnext.accounts.utils import get_balance_on
        for acc in holding_accounts:
            holding_balance += abs(flt(get_balance_on(acc)))
            
    if holding_balance > 0:
        alerts.append({
            "title": "Pending Supplier Top-ups",
            "desc": f"You have {frappe.format_value(holding_balance, 'Currency')} sitting in the Top-Up Holding Account pending reconciliation with Rubis.",
            "type": "warning",
            "icon": "payments"
        })

    # Pending Borrowed Products
    bp_station_clause = ""
    bp_params = []
    if station and station not in ("ALL", "All Stations", ""):
        bp_station_clause = " AND bp.station = %s"
        bp_params.append(station)
        
    pending_bp_records = frappe.db.sql(f"""
        SELECT 
            bp.name, bp.station, bp.date, bp.return_date, bp.counterparty, bp.type, bp.status, bp.memo
        FROM `tabBorrowed Product` bp
        WHERE bp.status = 'Pending Return' {bp_station_clause}
        ORDER BY bp.date DESC, bp.creation DESC
        LIMIT 100
    """, bp_params, as_dict=True)
    
    if pending_bp_records:
        names = [r.name for r in pending_bp_records]
        items = frappe.get_all("Borrowed Product Item",
            filters={"parent": ["in", names]},
            fields=["parent", "item_code", "qty"]
        )
        item_codes = list(set([i.item_code for i in items if i.item_code]))
        item_name_map = {}
        if item_codes:
            item_data = frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_name"])
            item_name_map = {d.name: (d.item_name or d.name) for d in item_data}

        items_map = {}
        for item in items:
            item["item_name"] = item_name_map.get(item.item_code, item.item_code)
            items_map.setdefault(item.parent, []).append(item)
        for r in pending_bp_records:
            r["items"] = items_map.get(r.name, [])
            
    if len(pending_bp_records) > 0:
        st_label = f" for {station}" if station and station not in ("ALL", "All Stations", "") else ""
        alerts.append({
            "title": f"Pending Borrowed Products{st_label} ({len(pending_bp_records)})",
            "desc": f"There are {len(pending_bp_records)} borrowed product transactions awaiting settlement or return.",
            "type": "warning",
            "icon": "sync_alt"
        })

    # M-Pesa Tills Live Balance Calculation
    mpesa_station_filter = ""
    mpesa_station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        mpesa_station_filter = " AND station = %s"
        mpesa_station_args.append(station)

    active_tills = frappe.db.sql(f"""
        SELECT name, till_name, till_number, station, default_account, bank_account
        FROM `tabM-Pesa Till`
        WHERE is_active = 1 {mpesa_station_filter}
        ORDER BY station ASC, till_name ASC
    """, mpesa_station_args, as_dict=True)

    tills_summary = []
    total_live_mpesa = 0.0
    mpesa_account_names = set()

    for t in active_tills:
        if t.default_account:
            mpesa_account_names.add(t.default_account)

        latest_reading = frappe.db.sql("""
            SELECT mp.closing_balance, mp.opening_balance, mp.amount, s.shift_date, s.status
            FROM `tabShift M-Pesa Payment` mp
            JOIN `tabShift` s ON s.name = mp.parent
            WHERE mp.mpesa_till = %s AND s.docstatus < 2
            ORDER BY s.shift_date DESC, s.creation DESC
            LIMIT 1
        """, (t.name,), as_dict=True)

        till_balance = 0.0
        last_date = None
        if latest_reading:
            r = latest_reading[0]
            last_date = r.shift_date
            if r.status == "Closed" or flt(r.closing_balance) > 0:
                till_balance = flt(r.closing_balance)
            else:
                till_balance = flt(r.opening_balance)
        
        total_live_mpesa += till_balance
        tills_summary.append({
            "till": t.name,
            "station": t.station,
            "balance": till_balance,
            "last_date": str(last_date) if last_date else "",
            "account": t.default_account or "",
            "bank_account": t.bank_account or ""
        })

    gl_mpesa_balance = 0.0
    if mpesa_account_names:
        from erpnext.accounts.utils import get_balance_on
        for acc in mpesa_account_names:
            gl_mpesa_balance += flt(get_balance_on(acc))

    mpesa_live_data = {
        "total_balance": total_live_mpesa,
        "gl_balance": gl_mpesa_balance,
        "tills_count": len(active_tills),
        "tills": tills_summary
    }

    # Return Payload
    return {
        "financials": {
            "total_sales_today": total_sales_today,
            "collections": collections,
            "top_up_holding_balance": holding_balance,
            "mpesa_live": mpesa_live_data
        },
        "reconciliations": {
            "fuel_variance_today": shift_variance
        },
        "inventory": {
            "tank_levels": tank_levels,
            "summary": tank_data.get("summary", {})
        },
        "pending_borrowed": {
            "count": len(pending_bp_records),
            "records": pending_bp_records
        },
        "alerts": alerts,
        "date": f"{formatdate(from_date)} to {formatdate(to_date)}",
        "station": station or "All Stations"
    }

@frappe.whitelist()
def get_pending_borrowed_summary(station=None):
    """Returns all pending borrowed product transactions, optionally filtered by station."""
    station_clause = ""
    params = []
    if station and station not in ("ALL", "All Stations", ""):
        station_clause = " AND bp.station = %s"
        params.append(station)
        
    records = frappe.db.sql(f"""
        SELECT 
            bp.name, bp.station, bp.date, bp.return_date, bp.counterparty, bp.type, bp.status, bp.memo
        FROM `tabBorrowed Product` bp
        WHERE bp.status = 'Pending Return' {station_clause}
        ORDER BY bp.date DESC, bp.creation DESC
        LIMIT 100
    """, params, as_dict=True)
    
    if records:
        names = [r.name for r in records]
        items = frappe.get_all("Borrowed Product Item",
            filters={"parent": ["in", names]},
            fields=["parent", "item_code", "qty"]
        )
        item_codes = list(set([i.item_code for i in items if i.item_code]))
        item_name_map = {}
        if item_codes:
            item_data = frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_name"])
            item_name_map = {d.name: (d.item_name or d.name) for d in item_data}

        items_map = {}
        for item in items:
            item["item_name"] = item_name_map.get(item.item_code, item.item_code)
            items_map.setdefault(item.parent, []).append(item)
        for r in records:
            r["items"] = items_map.get(r.name, [])
            
    return records

@frappe.whitelist()
def get_tank_levels(station=None):
    """
    Returns live tank levels based on the latest physical dip stick readings
    recorded in shift operations, with capacity, ullage, and gauge metrics.
    """
    params = []
    station_clause = ""
    if station:
        station_clause = "WHERE t.station = %s"
        params.append(station)

    sql = f"""
        SELECT 
            t.name as tank_name,
            t.tank_name as display_name,
            t.capacity,
            t.fuel_product,
            t.station,
            t.reorder_threshold,
            t.variance_tolerance,
            latest_dip.dip_value as last_dip_volume,
            latest_dip.opening_dip,
            latest_dip.closing_dip,
            latest_dip.dip_type,
            latest_dip.expected_stock,
            latest_dip.variance,
            latest_dip.shift_id,
            latest_dip.shift_date,
            latest_dip.shift_name_display,
            latest_dip.reading_time
        FROM `tabFuel Tank` t
        LEFT JOIN (
            SELECT 
                r.fuel_tank,
                CASE 
                    WHEN r.closing_dip > 0 THEN r.closing_dip 
                    ELSE r.opening_dip 
                END as dip_value,
                r.opening_dip,
                r.closing_dip,
                CASE 
                    WHEN r.closing_dip > 0 THEN 'Closing Dip' 
                    ELSE 'Opening Dip' 
                END as dip_type,
                r.expected_stock,
                r.variance,
                s.name as shift_id,
                s.shift_date,
                s.shift_name_display,
                r.creation as reading_time,
                ROW_NUMBER() OVER(PARTITION BY r.fuel_tank ORDER BY s.shift_date DESC, r.creation DESC) as rn
            FROM `tabDip Stick Reading` r
            INNER JOIN `tabShift` s ON r.parent = s.name
            WHERE (r.closing_dip > 0 OR r.opening_dip > 0)
        ) latest_dip ON t.name = latest_dip.fuel_tank AND latest_dip.rn = 1
        {station_clause}
        ORDER BY t.name
    """
    tanks = frappe.db.sql(sql, tuple(params), as_dict=True)

    total_capacity = 0.0
    total_volume = 0.0
    critical_count = 0

    for t in tanks:
        cap = flt(t.capacity) or 10000.0
        vol = flt(t.last_dip_volume) or 0.0
        pct = round((vol / cap) * 100, 1) if cap > 0 else 0.0
        ullage = max(0.0, cap - vol)
        threshold = flt(t.reorder_threshold) or 15.0

        if pct <= threshold:
            status = "critical"
            status_label = "CRITICAL REORDER"
            critical_count += 1
        elif pct <= 35.0:
            status = "low"
            status_label = "LOW STOCK"
        elif pct < 75.0:
            status = "normal"
            status_label = "NORMAL"
        else:
            status = "optimal"
            status_label = "OPTIMAL / FULL"

        p_name = (t.fuel_product or t.tank_name or "").upper()
        if "PETROL" in p_name or "PMS" in p_name or "SUPER" in p_name:
            fuel_category = "PMS"
            fuel_label = "Petrol (PMS)"
            fuel_color = "#0284c7"
            fuel_badge_bg = "#e0f2fe"
            fuel_badge_text = "#0369a1"
        elif "DIESEL" in p_name or "AGO" in p_name:
            fuel_category = "AGO"
            fuel_label = "Diesel (AGO)"
            fuel_color = "#d97706"
            fuel_badge_bg = "#fef3c7"
            fuel_badge_text = "#b45309"
        elif "KEROSENE" in p_name or "IK" in p_name:
            fuel_category = "IK"
            fuel_label = "Kerosene (IK)"
            fuel_color = "#7c3aed"
            fuel_badge_bg = "#f3e8ff"
            fuel_badge_text = "#6d28d9"
        else:
            fuel_category = "FUEL"
            fuel_label = t.fuel_product or "Fuel"
            fuel_color = "#475569"
            fuel_badge_bg = "#f1f5f9"
            fuel_badge_text = "#334155"

        t.capacity = cap
        t.max_capacity = cap
        t.current_volume = vol
        t.last_dip_volume = vol
        t.percentage = pct
        t.ullage = ullage
        t.status = status
        t.status_label = status_label
        t.fuel_category = fuel_category
        t.fuel_label = fuel_label
        t.fuel_color = fuel_color
        t.fuel_badge_bg = fuel_badge_bg
        t.fuel_badge_text = fuel_badge_text
        t.reorder_threshold = threshold
        t.formatted_time = frappe.utils.format_datetime(t.reading_time, "dd MMM yyyy, hh:mm a") if t.reading_time else "No dip recorded"
        t.shift_title = t.shift_name_display or t.shift_id or "N/A"

        total_capacity += cap
        total_volume += vol

    overall_pct = round((total_volume / total_capacity) * 100, 1) if total_capacity > 0 else 0.0
    overall_ullage = max(0.0, total_capacity - total_volume)

    return {
        "tanks": tanks,
        "summary": {
            "total_tanks": len(tanks),
            "total_capacity": total_capacity,
            "total_volume": total_volume,
            "overall_pct": overall_pct,
            "overall_ullage": overall_ullage,
            "critical_count": critical_count
        }
    }

@frappe.whitelist()
def get_pnl_summary(from_date=None, to_date=None, company=None, station=None):
    """Returns a structured, multi-tier Profit and Loss Statement for the selected period, optionally filtered by Station."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1)
    
    if not company:
        company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    if not frappe.db.exists("DocType", "GL Entry"):
        return {"error": "Accounting module not found."}

    # Normalize station parameter
    if station in ("ALL", "All Stations", "All Stations (Consolidated)", "", None):
        station = None

    gl_entries = frappe.db.sql("""
        SELECT 
            gl.account,
            a.account_name,
            a.root_type,
            a.parent_account,
            a.account_type,
            gl.voucher_type,
            gl.voucher_no,
            gl.debit,
            gl.credit,
            gl.remarks,
            gl.cost_center
        FROM `tabGL Entry` gl
        JOIN `tabAccount` a ON gl.account = a.name
        WHERE gl.posting_date >= %s AND gl.posting_date <= %s 
        AND gl.is_cancelled = 0
        AND (gl.company = %s OR %s IS NULL OR %s = '')
    """, (from_date, to_date, company, company, company), as_dict=True)

    se_warehouses = dict(frappe.db.sql("""
        SELECT name, CONCAT(COALESCE(from_warehouse, ''), ' | ', COALESCE(to_warehouse, ''), ' | ', COALESCE(remarks, ''))
        FROM `tabStock Entry`
        WHERE posting_date >= %s AND posting_date <= %s
    """, (from_date, to_date)))

    pi_warehouses = dict(frappe.db.sql("""
        SELECT pii.parent, GROUP_CONCAT(DISTINCT pii.warehouse)
        FROM `tabPurchase Invoice Item` pii
        JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
        WHERE pi.posting_date >= %s AND pi.posting_date <= %s
        GROUP BY pii.parent
    """, (from_date, to_date)))

    sr_warehouses = dict(frappe.db.sql("""
        SELECT sri.parent, GROUP_CONCAT(DISTINCT sri.warehouse)
        FROM `tabStock Reconciliation Item` sri
        JOIN `tabStock Reconciliation` sr ON sri.parent = sr.name
        WHERE sr.posting_date >= %s AND sr.posting_date <= %s
        GROUP BY sri.parent
    """, (from_date, to_date)))

    shift_stations = dict(frappe.db.sql("SELECT name, station FROM `tabShift`"))

    jv_remarks = dict(frappe.db.sql("""
        SELECT name, user_remark FROM `tabJournal Entry` 
        WHERE posting_date >= %s AND posting_date <= %s
    """, (from_date, to_date)))

    def attribute_entry(r):
        cc = (r.get('cost_center') or '').upper()
        if "GALANA" in cc:
            return "Galana Annex"
        if "RUBIS" in cc or "POA" in cc:
            return "RUBIS POA PLACE"

        acc_str = (r['account'] + " " + (r.get('account_name') or '')).upper()
        v_no = r.get('voucher_no') or ""
        v_type = r.get('voucher_type') or ""
        rem = (r.get('remarks') or '').upper()

        if "GALANA" in acc_str:
            return "Galana Annex"
        if "RUBIS" in acc_str:
            return "RUBIS POA PLACE"
        if v_type == "Stock Reconciliation" and v_no in sr_warehouses:
            sr_info = (sr_warehouses[v_no] or "").upper()
            if "GALANA" in sr_info:
                return "Galana Annex"
            elif "RUBIS" in sr_info or "POA" in sr_info:
                return "RUBIS POA PLACE"
        if v_type == "Stock Entry" and v_no in se_warehouses:
            se_info = se_warehouses[v_no].upper()
            if "GALANA" in se_info:
                return "Galana Annex"
            elif "RUBIS" in se_info or "POA" in se_info:
                return "RUBIS POA PLACE"
        if v_type == "Purchase Invoice" and v_no in pi_warehouses:
            pi_info = (pi_warehouses[v_no] or "").upper()
            if "GALANA" in pi_info:
                return "Galana Annex"
            elif "RUBIS" in pi_info or "POA" in pi_info:
                return "RUBIS POA PLACE"
        if v_type == "Journal Entry":
            j_rem = (jv_remarks.get(v_no) or rem).upper()
            for sh_name, sh_st in shift_stations.items():
                if sh_name.upper() in j_rem or sh_name.upper() in rem:
                    return sh_st
            if "GALANA" in j_rem:
                return "Galana Annex"
            elif "RUBIS" in j_rem:
                return "RUBIS POA PLACE"
        return None

    income_items = []
    cogs_items = []
    opex_items = []

    total_income = 0.0
    total_cogs = 0.0
    total_opex = 0.0

    # Aggregate entries by account after station attribution
    accounts_agg = {}
    for r in gl_entries:
        if r['root_type'] not in ('Income', 'Expense'):
            continue

        assigned_st = attribute_entry(r)

        if station:
            if assigned_st:
                if assigned_st.lower() != station.lower():
                    continue
            else:
                if "galana" in station.lower():
                    continue
                elif "rubis" in station.lower():
                    pass

        acc = r['account']
        if acc not in accounts_agg:
            accounts_agg[acc] = {
                "account": acc,
                "account_name": r['account_name'] or acc,
                "root_type": r['root_type'],
                "parent_account": r['parent_account'],
                "account_type": r['account_type'],
                "total_debit": 0.0,
                "total_credit": 0.0
            }
        accounts_agg[acc]["total_debit"] += flt(r['debit'])
        accounts_agg[acc]["total_credit"] += flt(r['credit'])

    # Calculate underlying Fuel vs Lube COGS components
    fuel_items = set(frappe.db.sql_list("SELECT name FROM tabItem WHERE item_group = 'FUELS' OR name IN ('DIESEL', 'Petrol 001', 'PMS', 'AGO', 'DPK')"))
    
    wh_pattern = None
    if station:
        if "galana" in station.lower():
            wh_pattern = "%Galana%"
        elif "rubis" in station.lower() or "poa" in station.lower():
            wh_pattern = "%POA%"

    # 1. Stock Entry Details (Fuel vs Lubes)
    if wh_pattern:
        se_details = frappe.db.sql('''
            SELECT sei.item_code, sei.amount
            FROM `tabStock Entry Detail` sei
            JOIN `tabStock Entry` se ON sei.parent = se.name
            WHERE se.posting_date >= %s AND se.posting_date <= %s
            AND se.docstatus = 1
            AND (se.from_warehouse LIKE %s OR se.remarks LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        se_details = frappe.db.sql('''
            SELECT sei.item_code, sei.amount
            FROM `tabStock Entry Detail` sei
            JOIN `tabStock Entry` se ON sei.parent = se.name
            WHERE se.posting_date >= %s AND se.posting_date <= %s
            AND se.docstatus = 1
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_se = sum(flt(r['amount']) for r in se_details if r['item_code'] in fuel_items)
    raw_lube_cogs_se = sum(flt(r['amount']) for r in se_details if r['item_code'] not in fuel_items)

    # 2. Purchase Invoices directly in COGS
    if wh_pattern:
        pi_details = frappe.db.sql('''
            SELECT pii.item_code, pii.amount
            FROM `tabPurchase Invoice Item` pii
            JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
            WHERE pi.posting_date >= %s AND pi.posting_date <= %s
            AND pii.expense_account = 'Cost of Goods Sold - KIL'
            AND pi.docstatus = 1
            AND (pii.warehouse LIKE %s OR pi.remarks LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        pi_details = frappe.db.sql('''
            SELECT pii.item_code, pii.amount
            FROM `tabPurchase Invoice Item` pii
            JOIN `tabPurchase Invoice` pi ON pii.parent = pi.name
            WHERE pi.posting_date >= %s AND pi.posting_date <= %s
            AND pii.expense_account = 'Cost of Goods Sold - KIL'
            AND pi.docstatus = 1
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_pi = sum(flt(r['amount']) for r in pi_details if r['item_code'] in fuel_items or not r['item_code'])
    raw_lube_cogs_pi = sum(flt(r['amount']) for r in pi_details if r['item_code'] and r['item_code'] not in fuel_items)

    # 3. Journal Entries hitting COGS
    if wh_pattern:
        jv_details = frappe.db.sql('''
            SELECT jv.user_remark, jvd.debit, jvd.credit
            FROM `tabJournal Entry Account` jvd
            JOIN `tabJournal Entry` jv ON jvd.parent = jv.name
            WHERE jv.posting_date >= %s AND jv.posting_date <= %s
            AND jvd.account = 'Cost of Goods Sold - KIL'
            AND jv.docstatus = 1
            AND (jv.user_remark LIKE %s OR jvd.cost_center LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        jv_details = frappe.db.sql('''
            SELECT jv.user_remark, jvd.debit, jvd.credit
            FROM `tabJournal Entry Account` jvd
            JOIN `tabJournal Entry` jv ON jvd.parent = jv.name
            WHERE jv.posting_date >= %s AND jv.posting_date <= %s
            AND jvd.account = 'Cost of Goods Sold - KIL'
            AND jv.docstatus = 1
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_jv = 0.0
    raw_lube_cogs_jv = 0.0
    for j in jv_details:
        net = flt(j['debit']) - flt(j['credit'])
        rem = (j.get('user_remark') or '').upper()
        if any(k in rem for k in ['FUEL', 'DIESEL', 'PETROL', 'PMS', 'AGO']):
            raw_fuel_cogs_jv += net
        else:
            raw_lube_cogs_jv += net

    # 4. Stock Reconciliation hitting COGS
    if wh_pattern:
        sr_details = frappe.db.sql('''
            SELECT sri.item_code, sri.amount_difference as amount
            FROM `tabStock Reconciliation Item` sri
            JOIN `tabStock Reconciliation` sr ON sri.parent = sr.name
            WHERE sr.posting_date >= %s AND sr.posting_date <= %s
            AND sr.docstatus = 1
            AND sr.expense_account = 'Cost of Goods Sold - KIL'
            AND (sri.warehouse LIKE %s OR sr.cost_center LIKE %s)
        ''', (from_date, to_date, wh_pattern, wh_pattern), as_dict=True)
    else:
        sr_details = frappe.db.sql('''
            SELECT sri.item_code, sri.amount_difference as amount
            FROM `tabStock Reconciliation Item` sri
            JOIN `tabStock Reconciliation` sr ON sri.parent = sr.name
            WHERE sr.posting_date >= %s AND sr.posting_date <= %s
            AND sr.docstatus = 1
            AND sr.expense_account = 'Cost of Goods Sold - KIL'
        ''', (from_date, to_date), as_dict=True)

    raw_fuel_cogs_sr = sum(flt(r['amount']) for r in sr_details if r['item_code'] in fuel_items)
    raw_lube_cogs_sr = sum(flt(r['amount']) for r in sr_details if r['item_code'] and r['item_code'] not in fuel_items)

    comp_fuel_cogs = raw_fuel_cogs_se + raw_fuel_cogs_pi + raw_fuel_cogs_jv + raw_fuel_cogs_sr
    comp_lube_cogs = raw_lube_cogs_se + raw_lube_cogs_pi + raw_lube_cogs_jv + raw_lube_cogs_sr
    comp_total = comp_fuel_cogs + comp_lube_cogs

    cogs_main_bal = 0.0
    other_cogs_items = []

    for r in accounts_agg.values():
        if r['root_type'] == 'Income':
            bal = flt(r['total_credit']) - flt(r['total_debit'])
            if abs(bal) > 0.001:
                acc_name_upper = (r['account_name'] or r['account']).upper()
                category = "fuel" if any(k in acc_name_upper for k in ["FUEL", "PETROL", "DIESEL", "PMS", "AGO"]) else "lubes"
                income_items.append({
                    "account": r['account'],
                    "account_name": r['account_name'],
                    "parent_account": r['parent_account'],
                    "category": category,
                    "amount": round(bal, 2),
                    "balance": round(bal, 2)
                })
                total_income += bal
        elif r['root_type'] == 'Expense':
            bal = flt(r['total_debit']) - flt(r['total_credit'])
            if abs(bal) > 0.001:
                is_cogs = (
                    r['account_type'] == 'Cost of Goods Sold' or 
                    'Stock Expenses' in (r['parent_account'] or '') or 
                    'Cost of Goods Sold' in (r['account_name'] or '') or
                    'Stock Adjustment' in (r['account_name'] or '')
                )
                if is_cogs:
                    if 'Cost of Goods Sold' in (r['account_name'] or ''):
                        cogs_main_bal += bal
                    else:
                        other_cogs_items.append({
                            "account": r['account'],
                            "account_name": r['account_name'],
                            "parent_account": r['parent_account'],
                            "category": "adjustment",
                            "amount": round(bal, 2),
                            "balance": round(bal, 2)
                        })
                    total_cogs += bal
                else:
                    opex_items.append({
                        "account": r['account'],
                        "account_name": r['account_name'],
                        "parent_account": r['parent_account'],
                        "amount": round(bal, 2),
                        "balance": round(bal, 2)
                    })
                    total_opex += bal

    # Split main Cost of Goods Sold balance into Fuel vs Lubes based on underlying transactions
    fuel_cogs_amount = 0.0
    lube_cogs_amount = 0.0
    if abs(cogs_main_bal) > 0.001:
        if comp_total > 0:
            fuel_ratio = comp_fuel_cogs / comp_total
            fuel_cogs_amount = round(cogs_main_bal * fuel_ratio, 2)
            lube_cogs_amount = round(cogs_main_bal - fuel_cogs_amount, 2)
        else:
            fuel_cogs_amount = round(cogs_main_bal, 2)
            lube_cogs_amount = 0.0

    if abs(fuel_cogs_amount) > 0.001:
        cogs_items.append({
            "account": "Cost of Fuel Sold",
            "account_name": "Cost of Goods Sold - Fuel (PMS & AGO)",
            "parent_account": "Stock Expenses - KIL",
            "category": "fuel",
            "amount": fuel_cogs_amount,
            "balance": fuel_cogs_amount
        })
    if abs(lube_cogs_amount) > 0.001:
        cogs_items.append({
            "account": "Cost of Lubes & Inventory",
            "account_name": "Cost of Goods Sold - Lubes & Inventory",
            "parent_account": "Stock Expenses - KIL",
            "category": "lubes",
            "amount": lube_cogs_amount,
            "balance": lube_cogs_amount
        })
    cogs_items.extend(other_cogs_items)

    total_income = round(total_income, 2)
    total_cogs = round(total_cogs, 2)
    total_opex = round(total_opex, 2)
    gross_profit = round(total_income - total_cogs, 2)
    gross_margin = round((gross_profit / total_income * 100), 2) if total_income else 0.0
    total_expense = round(total_cogs + total_opex, 2)
    net_profit = round(total_income - total_expense, 2)
    net_margin = round((net_profit / total_income * 100), 2) if total_income else 0.0

    fuel_income = sum(item["amount"] for item in income_items if item.get("category") == "fuel")
    lube_income = sum(item["amount"] for item in income_items if item.get("category") == "lubes")
    
    fuel_gross_profit = round(fuel_income - fuel_cogs_amount, 2)
    fuel_gross_margin = round((fuel_gross_profit / fuel_income * 100), 2) if fuel_income else 0.0
    
    lube_gross_profit = round(lube_income - lube_cogs_amount, 2)
    lube_gross_margin = round((lube_gross_profit / lube_income * 100), 2) if lube_income else 0.0

    # Calculate percentage share of turnover for each account
    for item in income_items:
        item["pct"] = round((item["amount"] / total_income * 100), 2) if total_income else 0.0
    for item in cogs_items:
        item["pct"] = round((item["amount"] / total_income * 100), 2) if total_income else 0.0
    for item in opex_items:
        item["pct"] = round((item["amount"] / total_income * 100), 2) if total_income else 0.0

    # Sort items by amount descending
    income_items.sort(key=lambda x: x["amount"], reverse=True)
    cogs_items.sort(key=lambda x: x["amount"], reverse=True)
    opex_items.sort(key=lambda x: x["amount"], reverse=True)

    return {
        "company": company,
        "station": station or "All Stations (Consolidated)",
        "period": f"{formatdate(from_date)} - {formatdate(to_date)}",
        "from_date": str(from_date),
        "to_date": str(to_date),
        "total_income": total_income,
        "fuel_income": round(fuel_income, 2),
        "lube_income": round(lube_income, 2),
        "total_cogs": total_cogs,
        "fuel_cogs": fuel_cogs_amount,
        "lube_cogs": lube_cogs_amount,
        "fuel_gross_profit": fuel_gross_profit,
        "fuel_gross_margin": fuel_gross_margin,
        "lube_gross_profit": lube_gross_profit,
        "lube_gross_margin": lube_gross_margin,
        "gross_profit": gross_profit,
        "gross_margin": gross_margin,
        "total_opex": total_opex,
        "total_expense": total_expense,
        "net_profit": net_profit,
        "net_margin": net_margin,
        "income_accounts": income_items,
        "cogs_accounts": cogs_items,
        "opex_accounts": opex_items,
        # backward compatibility:
        "expense_accounts": cogs_items + opex_items
    }


@frappe.whitelist()
def get_balance_sheet_summary(as_on_date=None, company=None, station=None):
    """
    Returns a comprehensive, multi-tier Balance Sheet (Statement of Financial Position)
    as of a selected date for the company, optionally filtered by station.
    """
    if not as_on_date:
        as_on_date = today()
        
    if not company:
        company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    if station in ("ALL", "All Stations", "All Stations (Consolidated)", "", None):
        station = None

    gl_data = frappe.db.sql("""
        SELECT 
            gl.account,
            a.account_name,
            a.root_type,
            a.parent_account,
            a.account_type,
            a.is_group,
            SUM(gl.debit) as total_debit,
            SUM(gl.credit) as total_credit
        FROM `tabGL Entry` gl
        JOIN `tabAccount` a ON gl.account = a.name
        WHERE gl.posting_date <= %s 
          AND gl.is_cancelled = 0
          AND (gl.company = %s OR %s IS NULL OR %s = '')
        GROUP BY gl.account
        ORDER BY a.root_type, a.parent_account, a.account_name
    """, (as_on_date, company, company, company), as_dict=True)

    if station:
        filtered_gl = []
        for r in gl_data:
            acc_str = (r['account'] + " " + (r.get('account_name') or '')).upper()
            if "galana" in station.lower():
                if "GALANA" in acc_str:
                    filtered_gl.append(r)
            elif "rubis" in station.lower():
                if "GALANA" not in acc_str:
                    filtered_gl.append(r)
        gl_data = filtered_gl

    assets_items = []
    liabilities_items = []
    equity_items = []
    
    total_assets = 0.0
    total_current_assets = 0.0
    total_non_current_assets = 0.0
    
    total_liabilities = 0.0
    total_current_liabilities = 0.0
    total_non_current_liabilities = 0.0
    
    total_equity = 0.0
    cum_income = 0.0
    cum_expense = 0.0

    for r in gl_data:
        debit = flt(r['total_debit'])
        credit = flt(r['total_credit'])
        acc_name = r['account_name'] or r['account']
        acc_type = r['account_type'] or ''
        parent = r['parent_account'] or ''
        
        if r['root_type'] == 'Asset':
            bal = debit - credit
            if abs(bal) > 0.001:
                is_cash_bank = acc_type in ('Cash', 'Bank') or 'Bank' in parent or 'Cash' in parent
                is_receivable = acc_type == 'Receivable' or 'Receivable' in parent or 'Debtor' in acc_name
                is_stock = acc_type == 'Stock' or 'Stock' in parent or 'Inventory' in acc_name
                is_fixed = acc_type in ('Fixed Asset', 'Accumulated Depreciation') or 'Fixed' in parent
                is_staff_short = 'Shortfall' in acc_name or 'CSA' in acc_name or 'Staff' in acc_name
                
                bucket = 'Other Current Assets'
                if is_cash_bank:
                    bucket = 'Cash & Bank Balances'
                elif is_staff_short:
                    bucket = 'Staff Shortfalls & Receivables'
                elif is_receivable:
                    bucket = 'Accounts Receivable (Debtors)'
                elif is_stock:
                    bucket = 'Inventories & Stock in Hand'
                elif 'Shift Control' in acc_name:
                    bucket = 'Station Shift Control & Clearing'
                elif is_fixed:
                    bucket = 'Property, Plant & Equipment (Fixed Assets)'
                    
                is_current = not is_fixed
                assets_items.append({
                    "account": r['account'],
                    "account_name": acc_name,
                    "parent_account": parent,
                    "account_type": acc_type,
                    "amount": round(bal, 2),
                    "bucket": bucket,
                    "is_current": is_current
                })
                total_assets += bal
                if is_current:
                    total_current_assets += bal
                else:
                    total_non_current_assets += bal

        elif r['root_type'] == 'Liability':
            bal = credit - debit
            if abs(bal) > 0.001:
                is_payable = acc_type == 'Payable' or 'Payable' in parent or 'Creditor' in acc_name
                is_tax = acc_type == 'Tax' or 'Tax' in parent or 'VAT' in acc_name or 'Payroll' in acc_name
                is_long = 'Long Term' in parent or 'Non-Current' in parent
                
                bucket = 'Other Liabilities'
                if is_payable:
                    bucket = 'Trade Accounts Payable (Creditors)'
                elif is_tax:
                    bucket = 'Duties, Taxes & Statutory Payables'
                elif 'Overdraft' in acc_name or 'Loan' in parent:
                    bucket = 'Loans & Borrowings'
                    
                is_current = not is_long
                liabilities_items.append({
                    "account": r['account'],
                    "account_name": acc_name,
                    "parent_account": parent,
                    "account_type": acc_type,
                    "amount": round(bal, 2),
                    "bucket": bucket,
                    "is_current": is_current
                })
                total_liabilities += bal
                if is_current:
                    total_current_liabilities += bal
                else:
                    total_non_current_liabilities += bal

        elif r['root_type'] == 'Equity':
            bal = credit - debit
            if abs(bal) > 0.001:
                equity_items.append({
                    "account": r['account'],
                    "account_name": acc_name,
                    "parent_account": parent,
                    "account_type": acc_type,
                    "amount": round(bal, 2),
                    "bucket": 'Capital & Reserves'
                })
                total_equity += bal

        elif r['root_type'] == 'Income':
            cum_income += (credit - debit)
        elif r['root_type'] == 'Expense':
            cum_expense += (debit - credit)

    provisional_profit = round(cum_income - cum_expense, 2)
    total_equity_with_profit = round(total_equity + provisional_profit, 2)
    total_liabilities_and_equity = round(total_liabilities + total_equity_with_profit, 2)
    
    total_assets = round(total_assets, 2)
    total_liabilities = round(total_liabilities, 2)
    total_current_assets = round(total_current_assets, 2)
    total_current_liabilities = round(total_current_liabilities, 2)
    total_non_current_assets = round(total_non_current_assets, 2)
    total_non_current_liabilities = round(total_non_current_liabilities, 2)
    
    working_capital = round(total_current_assets - total_current_liabilities, 2)
    current_ratio = round(total_current_assets / total_current_liabilities, 2) if total_current_liabilities else 0.0
    debt_to_equity = round(total_liabilities / total_equity_with_profit, 2) if total_equity_with_profit else 0.0
    
    difference = round(abs(total_assets - total_liabilities_and_equity), 2)
    is_balanced = difference <= 0.05

    def group_buckets(items, bucket_order=None):
        buckets_dict = {}
        for it in items:
            buckets_dict.setdefault(it['bucket'], []).append(it)
        res = []
        keys = list(buckets_dict.keys())
        if bucket_order:
            ordered_keys = [k for k in bucket_order if k in buckets_dict]
            remaining_keys = [k for k in keys if k not in bucket_order]
            keys = ordered_keys + remaining_keys
        for b_name in keys:
            b_items = buckets_dict[b_name]
            subtotal = sum(i['amount'] for i in b_items)
            res.append({
                "bucket_name": b_name,
                "subtotal": round(subtotal, 2),
                "items": b_items
            })
        return res

    asset_order = [
        'Cash & Bank Balances',
        'Accounts Receivable (Debtors)',
        'Staff Shortfalls & Receivables',
        'Inventories & Stock in Hand',
        'Station Shift Control & Clearing',
        'Other Current Assets',
        'Property, Plant & Equipment (Fixed Assets)'
    ]
    liability_order = [
        'Trade Accounts Payable (Creditors)',
        'Duties, Taxes & Statutory Payables',
        'Loans & Borrowings',
        'Other Liabilities'
    ]

    return {
        "as_on_date": str(as_on_date),
        "as_on_date_formatted": formatdate(as_on_date),
        "company": company,
        "station": station or "All Stations (Consolidated)",
        "summary": {
            "total_assets": total_assets,
            "current_assets": total_current_assets,
            "non_current_assets": total_non_current_assets,
            "total_liabilities": total_liabilities,
            "current_liabilities": total_current_liabilities,
            "non_current_liabilities": total_non_current_liabilities,
            "total_equity": total_equity,
            "provisional_profit": provisional_profit,
            "total_equity_and_reserves": total_equity_with_profit,
            "total_liabilities_and_equity": total_liabilities_and_equity,
            "working_capital": working_capital,
            "current_ratio": current_ratio,
            "debt_to_equity": debt_to_equity,
            "is_balanced": is_balanced,
            "difference": difference
        },
        "asset_groups": group_buckets(assets_items, asset_order),
        "liability_groups": group_buckets(liabilities_items, liability_order),
        "equity_groups": group_buckets(equity_items)
    }

    
@frappe.whitelist()
def get_employee_shorts(from_date=None, to_date=None, station=None):
    """Returns a summary of cash shortages per employee for the selected period."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1)
    
    params = [from_date, to_date]
    station_clause = ""
    if station and station not in ("ALL", "All Stations", ""):
        station_clause = " AND station = %s"
        params.append(station)

    shorts = frappe.db.sql(f"""
        SELECT owner as employee, SUM(cash_variance) as total_variance
        FROM `tabShift`
        WHERE docstatus < 2 
        AND shift_date >= %s AND shift_date <= %s {station_clause}
        GROUP BY owner
        HAVING total_variance != 0
        ORDER BY total_variance ASC
    """, params, as_dict=True)
    
    return {
        "shorts": shorts,
        "period": f"{formatdate(from_date)} to {formatdate(to_date)}"
    }

import re
from datetime import datetime, timedelta

def parse_lube_litres(item_code, item_name):
    txt = f"{item_code} {item_name}".upper()
    m_ml = re.search(r'(\d+(?:\.\d+)?)\s*ML\b', txt)
    if m_ml:
        try:
            return float(m_ml.group(1)) / 1000.0
        except Exception:
            pass
    m_l = re.search(r'(\d+(?:\.\d+)?)\s*L(?:TR|ITRE|ITRES|TRS)?\b', txt)
    if m_l:
        try:
            return float(m_l.group(1))
        except Exception:
            pass
    return 1.0

def parse_gas_kg(item_code, item_name):
    txt = f"{item_code} {item_name}".upper()
    m_kg = re.search(r'(\d+(?:\.\d+)?)\s*KG\b', txt)
    if m_kg:
        try:
            return float(m_kg.group(1))
        except Exception:
            pass
    return 1.0

def extract_kg_sort(val):
    txt = str(val or "").upper()
    m = re.search(r'(\d+(?:\.\d+)?)', txt)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    return 999.0

@frappe.whitelist()
def get_sales_analytics(from_date=None, to_date=None, station=None):
    if not to_date:
        to_date = today()
    if not from_date:
        # Default to 7 days window (today - 6 days to today)
        from_date = frappe.utils.add_days(to_date, -6)
        
    d_start = getdate(from_date)
    d_end = getdate(to_date)
    
    # Generate daily sequence of dates
    num_days = (d_end - d_start).days + 1
    date_list = [(d_start + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(num_days)]
    date_labels = [(d_start + timedelta(days=i)).strftime('%d %b') for i in range(num_days)]

    station_clause = ""
    station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        station_clause = " AND s.station = %s"
        station_args.append(station)

    # 1. Fuel Sales Breakdown & Time-Series
    fuel_readings = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            t.fuel_product as item_code,
            SUM(CASE WHEN UPPER(COALESCE(s.shift_template, '')) LIKE '%%DAY%%' THEN r.sales_quantity_electronic ELSE 0 END) as day_liters,
            SUM(CASE WHEN UPPER(COALESCE(s.shift_template, '')) LIKE '%%NIGHT%%' THEN r.sales_quantity_electronic ELSE 0 END) as night_liters,
            SUM(r.sales_quantity_electronic) as total_liters
        FROM `tabPump Meter Reading` r
        JOIN `tabShift` s ON r.parent = s.name
        LEFT JOIN `tabPump Nozzle` n ON r.pump_nozzle = n.name
        LEFT JOIN `tabFuel Tank` t ON n.fuel_tank = t.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND t.fuel_product IS NOT NULL {station_clause}
        GROUP BY s.shift_date, t.fuel_product
        ORDER BY s.shift_date ASC, t.fuel_product ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    # Pre-fetch pricing mapping with station price list fallback
    station_pl = frappe.db.get_value("Fuel Station", station, "default_selling_price_list") if (station and station not in ("ALL", "All Stations", "")) else None
    price_map = {}
    def get_price(item_code, shift_date):
        key = f"{item_code}_{shift_date}"
        if key in price_map:
            return price_map[key]
        price = 0.0
        if station_pl:
            p_rec = frappe.get_all("Item Price", 
                filters={"item_code": item_code, "price_list": station_pl, "valid_from": ("<=", shift_date)},
                fields=["price_list_rate"],
                order_by="valid_from desc",
                limit=1
            )
            if p_rec:
                price = flt(p_rec[0].price_list_rate)
        if not price:
            p_rec = frappe.get_all("Item Price", 
                filters={"item_code": item_code, "price_list": "Standard Selling", "valid_from": ("<=", shift_date)},
                fields=["price_list_rate"],
                order_by="valid_from desc",
                limit=1
            )
            if p_rec:
                price = flt(p_rec[0].price_list_rate)
        price_map[key] = price
        return price

    fuel_products = sorted(list(set(r.item_code for r in fuel_readings if r.item_code)))
    fuel_series = []
    fuel_summary = {}
    total_fuel_liters = 0.0
    total_fuel_revenue = 0.0

    for prod in fuel_products:
        daily_map = {d: 0.0 for d in date_list}
        tot_day = 0.0
        tot_night = 0.0
        tot_liters = 0.0
        tot_rev = 0.0
        
        for r in fuel_readings:
            if r.item_code == prod:
                sd = str(r.shift_date)
                if sd in daily_map:
                    daily_map[sd] += flt(r.total_liters or 0.0)
                tot_day += flt(r.day_liters or 0.0)
                tot_night += flt(r.night_liters or 0.0)
                tot_liters += flt(r.total_liters or 0.0)
                price = get_price(prod, sd)
                tot_rev += flt(r.total_liters or 0.0) * price
                
        fuel_series.append({
            "name": prod,
            "values": [round(daily_map[d], 2) for d in date_list]
        })
        
        fuel_summary[prod] = {
            "item_code": prod,
            "day_liters": round(tot_day, 2),
            "night_liters": round(tot_night, 2),
            "total_liters": round(tot_liters, 2),
            "revenue": round(tot_rev, 2)
        }
        total_fuel_liters += tot_liters
        total_fuel_revenue += tot_rev

    # 2. Lubes Sales (In Litres)
    lubes_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) = 'LUBES' {station_clause}
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_lubes_liters = {d: 0.0 for d in date_list}
    lubes_items_dict = {}
    total_lubes_liters = 0.0
    total_lubes_revenue = 0.0

    for row in lubes_raw:
        sd = str(row.shift_date)
        pack_l = parse_lube_litres(row.item_code, row.item_name)
        row_liters = flt(row.qty or 0.0) * pack_l
        if sd in daily_lubes_liters:
            daily_lubes_liters[sd] += row_liters
        
        code = row.item_code
        if code not in lubes_items_dict:
            lubes_items_dict[code] = {
                "item_code": code,
                "item_name": row.item_name or code,
                "pack_size": pack_l,
                "qty": 0.0,
                "total_liters": 0.0,
                "revenue": 0.0
            }
        lubes_items_dict[code]["qty"] += flt(row.qty or 0.0)
        lubes_items_dict[code]["total_liters"] += row_liters
        lubes_items_dict[code]["revenue"] += flt(row.revenue or 0.0)
        total_lubes_liters += row_liters
        total_lubes_revenue += flt(row.revenue or 0.0)

    lubes_list = sorted(lubes_items_dict.values(), key=lambda x: x["total_liters"], reverse=True)
    lubes_timeline = [round(daily_lubes_liters[d], 2) for d in date_list]

    # 3. Gas & Cylinders
    gas_cyl_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) IN ('GAS', 'CYLINDER') {station_clause}
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_gas_kgs = {d: 0.0 for d in date_list}
    daily_cylinders = {d: 0.0 for d in date_list}
    gas_items_dict = {}
    cyl_items_dict = {}
    total_gas_kgs = 0.0
    total_cylinders_count = 0.0
    total_gas_rev = 0.0
    total_cyl_rev = 0.0

    for row in gas_cyl_raw:
        sd = str(row.shift_date)
        grp = (row.item_group or "").upper()
        qty = flt(row.qty or 0.0)
        rev = flt(row.revenue or 0.0)
        code = row.item_code
        
        if "GAS" in grp:
            kg_rating = parse_gas_kg(row.item_code, row.item_name)
            tot_kg = qty * kg_rating
            if sd in daily_gas_kgs:
                daily_gas_kgs[sd] += tot_kg
            if code not in gas_items_dict:
                gas_items_dict[code] = {
                    "item_code": code,
                    "item_name": row.item_name or code,
                    "kg_rating": kg_rating,
                    "qty": 0.0,
                    "total_kg": 0.0,
                    "revenue": 0.0
                }
            gas_items_dict[code]["qty"] += qty
            gas_items_dict[code]["total_kg"] += tot_kg
            gas_items_dict[code]["revenue"] += rev
            total_gas_kgs += tot_kg
            total_gas_rev += rev
        elif "CYLINDER" in grp:
            if sd in daily_cylinders:
                daily_cylinders[sd] += qty
            if code not in cyl_items_dict:
                cyl_items_dict[code] = {
                    "item_code": code,
                    "item_name": row.item_name or code,
                    "qty": 0.0,
                    "revenue": 0.0
                }
            cyl_items_dict[code]["qty"] += qty
            cyl_items_dict[code]["revenue"] += rev
            total_cylinders_count += qty
            total_cyl_rev += rev

    gas_items_list = sorted(gas_items_dict.values(), key=lambda x: extract_kg_sort(x["item_code"]))
    cylinder_items_list = sorted(cyl_items_dict.values(), key=lambda x: extract_kg_sort(x["item_code"]))

    # 4. Filters & Accessories
    filters_acc_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) IN ('FILTERS', 'ACCESSORIES') {station_clause}
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_filters_qty = {d: 0.0 for d in date_list}
    filters_items_dict = {}
    total_filters_qty = 0.0
    total_filters_rev = 0.0

    for row in filters_acc_raw:
        sd = str(row.shift_date)
        qty = flt(row.qty or 0.0)
        rev = flt(row.revenue or 0.0)
        code = row.item_code
        if sd in daily_filters_qty:
            daily_filters_qty[sd] += qty
        if code not in filters_items_dict:
            filters_items_dict[code] = {
                "item_code": code,
                "item_name": row.item_name or code,
                "item_group": row.item_group or "FILTERS",
                "qty": 0.0,
                "revenue": 0.0
            }
        filters_items_dict[code]["qty"] += qty
        filters_items_dict[code]["revenue"] += rev
        total_filters_qty += qty
        total_filters_rev += rev

    filters_list = sorted(filters_items_dict.values(), key=lambda x: x["revenue"], reverse=True)

    # 5. Greasing Services
    greasing_raw = frappe.db.sql(f"""
        SELECT 
            s.shift_date,
            g.vehicle_type,
            SUM(g.number_of_vehicles) as vehicles_count,
            SUM(g.total_amount) as revenue
        FROM `tabShift Greasing Sale` g
        JOIN `tabShift` s ON g.parent = s.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s {station_clause}
        GROUP BY s.shift_date, g.vehicle_type
        ORDER BY s.shift_date ASC
    """, [from_date, to_date] + station_args, as_dict=True)

    daily_greasing_vehicles = {d: 0.0 for d in date_list}
    daily_greasing_rev = {d: 0.0 for d in date_list}
    greasing_types_dict = {}
    total_greasing_vehicles = 0.0
    total_greasing_rev = 0.0

    for row in greasing_raw:
        sd = str(row.shift_date)
        v_cnt = flt(row.vehicles_count or 0.0)
        v_rev = flt(row.revenue or 0.0)
        vt = (row.vehicle_type or "OTHER").strip().upper()
        
        if sd in daily_greasing_vehicles:
            daily_greasing_vehicles[sd] += v_cnt
            daily_greasing_rev[sd] += v_rev
            
        if vt not in greasing_types_dict:
            greasing_types_dict[vt] = {
                "vehicle_type": vt,
                "vehicles_count": 0.0,
                "revenue": 0.0
            }
        greasing_types_dict[vt]["vehicles_count"] += v_cnt
        greasing_types_dict[vt]["revenue"] += v_rev
        total_greasing_vehicles += v_cnt
        total_greasing_rev += v_rev

    for vt, g_info in greasing_types_dict.items():
        g_info["avg_rate"] = round(g_info["revenue"] / g_info["vehicles_count"], 2) if g_info["vehicles_count"] > 0 else 0.0

    greasing_list = sorted(greasing_types_dict.values(), key=lambda x: x["revenue"], reverse=True)

    total_non_fuel_revenue = round(total_lubes_revenue + total_gas_rev + total_cyl_rev + total_filters_rev + total_greasing_rev, 2)

    return {
        "dates": date_list,
        "date_labels": date_labels,
        "fuel": {
            "products": fuel_products,
            "series": fuel_series,
            "summary": fuel_summary,
            "total_liters": round(total_fuel_liters, 2),
            "total_revenue": round(total_fuel_revenue, 2),
            "total_day_liters": round(sum(flt(fs.get("day_liters", 0)) for fs in fuel_summary.values()), 2),
            "total_night_liters": round(sum(flt(fs.get("night_liters", 0)) for fs in fuel_summary.values()), 2)
        },
        "lubes": {
            "timeline_liters": lubes_timeline,
            "total_liters": round(total_lubes_liters, 2),
            "total_qty": round(sum(flt(x["qty"]) for x in lubes_list), 2),
            "total_revenue": round(total_lubes_revenue, 2),
            "items": lubes_list
        },
        "gas": {
            "timeline_kgs": [round(daily_gas_kgs[d], 2) for d in date_list],
            "timeline_cylinders": [round(daily_cylinders[d], 2) for d in date_list],
            "total_kgs": round(total_gas_kgs, 2),
            "total_qty": round(sum(flt(g["qty"]) for g in gas_items_list), 2),
            "total_cylinders": round(total_cylinders_count, 2),
            "total_gas_revenue": round(total_gas_rev, 2),
            "total_cylinder_revenue": round(total_cyl_rev, 2),
            "total_revenue": round(total_gas_rev, 2),
            "gas_items": gas_items_list,
            "cylinder_items": cylinder_items_list,
            "items": gas_items_list
        },
        "cylinders": {
            "timeline_units": [round(daily_cylinders[d], 2) for d in date_list],
            "total_units": round(total_cylinders_count, 2),
            "total_revenue": round(total_cyl_rev, 2),
            "items": cylinder_items_list
        },
        "accessories": {
            "timeline_qty": [round(daily_filters_qty[d], 2) for d in date_list],
            "total_qty": round(total_filters_qty, 2),
            "total_revenue": round(total_filters_rev, 2),
            "items": filters_list
        },
        "greasing": {
            "timeline_vehicles": [round(daily_greasing_vehicles[d], 2) for d in date_list],
            "timeline_revenue": [round(daily_greasing_rev[d], 2) for d in date_list],
            "total_vehicles": round(total_greasing_vehicles, 2),
            "total_revenue": round(total_greasing_rev, 2),
            "items": greasing_list
        },
        "non_fuel": {
            "total_revenue": total_non_fuel_revenue,
            "lubes_revenue": round(total_lubes_revenue, 2),
            "lubes_liters": round(total_lubes_liters, 2),
            "gas_revenue": round(total_gas_rev, 2),
            "gas_kgs": round(total_gas_kgs, 2),
            "cylinders_revenue": round(total_cyl_rev, 2),
            "cylinders_count": round(total_cylinders_count, 2),
            "filters_revenue": round(total_filters_rev, 2),
            "filters_count": round(total_filters_qty, 2),
            "greasing_revenue": round(total_greasing_rev, 2),
            "greasing_vehicles": round(total_greasing_vehicles, 2)
        }
    }



@frappe.whitelist()
def get_topup_statement(from_date, to_date, station=None, status="all", search=None):
    station_topup_clause = ""
    station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        station_topup_clause = " AND s.station = %s"
        station_args.append(station)

    # 1. Get Opening Balance (Topups before from_date)
    op_topup_sql = f"""
        SELECT SUM(t.amount) as amt 
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE t.date < %s {station_topup_clause}
    """
    op_topups = frappe.db.sql(op_topup_sql, [from_date] + station_args, as_dict=1)
    op_topup_amt = op_topups[0].amt if op_topups and op_topups[0].amt else 0.0
    
    deduct_where = "je.docstatus = 1 AND (je.user_remark LIKE %s OR je.user_remark LIKE %s) AND jea.debit > 0 AND je.posting_date < %s"
    deduct_params = ['[TOP-UP DEDUCTION]%', '[TOP-UP RECONCILIATION]%', from_date]
    if station and station not in ("ALL", "All Stations", ""):
        deduct_where += " AND je.user_remark LIKE %s"
        deduct_params.append(f"%for {station}%")

    op_deductions = frappe.db.sql(f"""
        SELECT SUM(jea.debit) as amt 
        FROM `tabJournal Entry` je 
        JOIN `tabJournal Entry Account` jea ON je.name = jea.parent 
        WHERE {deduct_where}
    """, deduct_params, as_dict=1)
    op_deduct_amt = op_deductions[0].amt if op_deductions and op_deductions[0].amt else 0.0
    
    running_balance = op_topup_amt - op_deduct_amt

    # 2. Fetch Period Topups
    status_filter = ""
    if status == "pending":
        status_filter = " AND COALESCE(t.is_reconciled, 0) = 0"
    elif status == "reconciled":
        status_filter = " AND COALESCE(t.is_reconciled, 0) = 1"

    search_filter = ""
    search_params = []
    if search and search.strip():
        s_term = f"%{search.strip()}%"
        search_filter = " AND (t.name LIKE %s OR t.rrn_number LIKE %s OR t.card LIKE %s OR sc.supplier LIKE %s)"
        search_params = [s_term, s_term, s_term, s_term]

    topups = frappe.db.sql(f"""
        SELECT 
            t.name as entry_name, t.date, t.shift, t.card,
            COALESCE(sc.supplier, 'RUBIS KENYA') as supplier,
            COALESCE(sc.card_name, t.card) as card_name,
            t.mode_of_payment as mode, t.rrn_number as ref, t.amount,
            s.station, t.creation,
            COALESCE(t.is_reconciled, 0) as is_reconciled,
            t.reconciled_date, t.reconciled_by, t.reconciled_jv, t.reconciled_ref
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        LEFT JOIN `tabSupplier Card` sc ON t.card = sc.name
        WHERE t.date BETWEEN %s AND %s {station_topup_clause} {status_filter} {search_filter}
    """, [from_date, to_date] + station_args + search_params, as_dict=True)
    
    # 3. Deductions (only include in statement if status is 'all' or 'reconciled')
    deductions = []
    if status != "pending":
        period_deduct_where = "je.docstatus = 1 AND (je.user_remark LIKE %s OR je.user_remark LIKE %s) AND jea.debit > 0 AND je.posting_date BETWEEN %s AND %s"
        period_deduct_params = ['[TOP-UP DEDUCTION]%', '[TOP-UP RECONCILIATION]%', from_date, to_date]
        if station and station not in ("ALL", "All Stations", ""):
            period_deduct_where += " AND je.user_remark LIKE %s"
            period_deduct_params.append(f"%for {station}%")

        deductions = frappe.db.sql(f"""
            SELECT 
                je.name as entry_name, je.posting_date as date, '' as shift, 'RECONCILIATION' as supplier,
                'RECONCILIATION' as card_name, '' as mode, je.cheque_no as ref, (jea.debit * -1) as amount,
                '' as station, je.creation, 1 as is_reconciled, je.posting_date as reconciled_date,
                '' as reconciled_by, je.name as reconciled_jv, je.cheque_no as reconciled_ref
            FROM `tabJournal Entry` je
            JOIN `tabJournal Entry Account` jea ON je.name = jea.parent
            WHERE {period_deduct_where}
        """, period_deduct_params, as_dict=True)
    
    # 4. Summary counts & pending amount for station
    unrecon_where = "COALESCE(t.is_reconciled, 0) = 0"
    unrecon_params = []
    if station and station not in ("ALL", "All Stations", ""):
        unrecon_where += " AND s.station = %s"
        unrecon_params.append(station)

    pending_summary = frappe.db.sql(f"""
        SELECT 
            COUNT(*) as pending_count,
            COALESCE(SUM(t.amount), 0) as pending_amount
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE {unrecon_where}
    """, unrecon_params, as_dict=True)
    
    pending_count = pending_summary[0].pending_count if pending_summary else 0
    pending_amount = flt(pending_summary[0].pending_amount) if pending_summary else 0.0

    # Period totals
    period_topups_sum = sum(flt(t.get('amount', 0)) for t in topups)
    period_reconciled_sum = sum(flt(t.get('amount', 0)) for t in topups if t.get('is_reconciled') == 1)

    data = topups + deductions
    # Sort by date, then creation
    data.sort(key=lambda x: (str(x.get('date')), str(x.get('creation'))))
    
    result = []
    # Insert opening balance row
    result.append({
        "date": from_date,
        "entry_name": "OPENING BALANCE",
        "shift": "",
        "station": "",
        "supplier": "",
        "card_name": "",
        "mode": "",
        "ref": "",
        "amount": 0.0,
        "running_balance": running_balance,
        "is_opening": True,
        "is_reconciled": 0
    })
    
    for d in data:
        running_balance += flt(d.get('amount', 0.0))
        d['running_balance'] = running_balance
        result.append(d)
        
    return {
        "statement": result,
        "pending_amount": pending_amount,
        "pending_count": pending_count,
        "running_balance": running_balance,
        "period_topups_sum": period_topups_sum,
        "period_reconciled_sum": period_reconciled_sum
    }


@frappe.whitelist()
def create_topup_deduction(station, amount=None, credit_account=None, date=None, reference=None, supplier=None, topup_names=None):
    from frappe.utils import flt, today
    import json
    
    if not station or station in ("ALL", "All Stations", ""):
        frappe.throw("Please select a specific Fuel Station to reconcile.")
        
    holding_account = frappe.db.get_value("Fuel Station", station, "top_up_holding_account")
    if not holding_account:
        cand = f"Top Up Holding Account - {station} - KIL"
        if frappe.db.exists("Account", cand):
            holding_account = cand
            frappe.db.set_value("Fuel Station", station, "top_up_holding_account", cand)
        else:
            frappe.throw(f"No Top Up Holding Account configured for Station: {station}")
        
    company = frappe.db.get_value("Fuel Station", station, "company") or frappe.db.get_single_value("Global Defaults", "default_company") or "KILIBET INVESTMENT LTD"

    # Normalize topup_names
    parsed_topups = []
    if topup_names:
        if isinstance(topup_names, str):
            try:
                parsed_topups = json.loads(topup_names)
            except Exception:
                parsed_topups = [x.strip() for x in topup_names.split(",") if x.strip()]
        elif isinstance(topup_names, (list, tuple)):
            parsed_topups = list(topup_names)

    selected_topups = []
    if parsed_topups:
        selected_topups = frappe.db.sql("""
            SELECT t.name, t.amount, t.card, t.rrn_number, sc.supplier
            FROM `tabStation Supplier Top Up` t
            LEFT JOIN `tabSupplier Card` sc ON t.card = sc.name
            WHERE t.name IN %s
        """, (tuple(parsed_topups),), as_dict=True)
        if not amount or flt(amount) <= 0:
            amount = sum(flt(t.amount) for t in selected_topups)
        if not supplier and selected_topups:
            supplier = selected_topups[0].supplier or "RUBIS KENYA"
        if not reference and selected_topups:
            rrns = [t.rrn_number for t in selected_topups if t.rrn_number]
            reference = ", ".join(rrns)[:100]

    amount = flt(amount)
    if amount <= 0:
        frappe.throw("Amount to reconcile must be greater than zero.")
        
    if not supplier:
        supplier = "RUBIS KENYA"
        
    if not credit_account:
        credit_account = frappe.get_cached_value("Company", company, "default_payable_account") or "Creditors - KIL"
        
    if not date:
        date = today()
        
    if not reference:
        reference = f"RECON-{frappe.utils.nowdate()}"

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = date
    je.cheque_no = reference
    topups_tag = f" (Topups: {', '.join(parsed_topups)})" if parsed_topups else ""
    je.user_remark = f"[TOP-UP DEDUCTION] Reconciled to {credit_account} for {station}{topups_tag}"
    
    # 1. Debit the holding account (clears the holding balance)
    je.append("accounts", {
        "account": holding_account,
        "debit_in_account_currency": amount,
        "user_remark": f"Clear Top-Up Holding for {station}"
    })
    
    # 2. Credit the target account (Supplier Account / Creditors or Bank)
    acc_type = frappe.db.get_value("Account", credit_account, "account_type")
    credit_row = {
        "account": credit_account,
        "credit_in_account_currency": amount,
        "user_remark": f"Top-Up posted to {supplier or credit_account} (Ref: {reference})"
    }
    if acc_type == "Payable":
        credit_row["party_type"] = "Supplier"
        credit_row["party"] = supplier
        
    je.append("accounts", credit_row)
    je.flags.ignore_permissions = True
    je.insert()
    je.submit()

    # 3. Mark selected top-ups as reconciled
    if parsed_topups:
        user = frappe.session.user
        user_fullname = frappe.get_cached_value("User", user, "full_name") or user
        by_name = f"{user_fullname} ({user})"
        now_dt = frappe.utils.now_datetime()
        frappe.db.sql("""
            UPDATE `tabStation Supplier Top Up`
            SET is_reconciled = 1,
                reconciled_date = %s,
                reconciled_by = %s,
                reconciled_jv = %s,
                reconciled_ref = %s
            WHERE name IN %s
        """, (now_dt, by_name, je.name, reference, tuple(parsed_topups)))
        frappe.db.commit()

    return {
        "status": "success",
        "message": f"Successfully reconciled KES {amount:,.2f} and posted to {credit_account} ({supplier})",
        "jv": je.name,
        "amount": amount
    }


@frappe.whitelist()
def get_reconciliation_data(reconciliation_type="customer_payments", from_date=None, to_date=None, status="all", party_or_card=None, search=None, page=1, page_length=50, station=None):
    """
    Returns filtered transactions and summary statistics for Customer Payments or Station Cards.
    """
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1).strftime("%Y-%m-%d")

    page = int(page or 1)
    page_length = int(page_length or 50)
    offset = (page - 1) * page_length

    # 1. Customer Payments Reconciliation
    if reconciliation_type == "customer_payments":
        where_clauses = ["1=1"]
        params = {}

        if from_date:
            where_clauses.append("cp.date >= %(from_date)s")
            params["from_date"] = from_date
        if to_date:
            where_clauses.append("cp.date <= %(to_date)s")
            params["to_date"] = to_date

        if status == "pending":
            where_clauses.append("COALESCE(cp.is_reconciled, 0) = 0")
        elif status == "reconciled":
            where_clauses.append("COALESCE(cp.is_reconciled, 0) = 1")

        if party_or_card and party_or_card != "ALL":
            where_clauses.append("cp.customer = %(party)s")
            params["party"] = party_or_card

        if station and station not in ("ALL", "All Stations", ""):
            where_clauses.append("(s.station = %(station)s OR (cp.shift IS NULL AND c.station = %(station)s))")
            params["station"] = station

        if search:
            search_pattern = f"%{search.strip()}%"
            where_clauses.append("""(
                cp.name LIKE %(s)s 
                OR cp.trans_no LIKE %(s)s 
                OR cp.shift LIKE %(s)s 
                OR cp.customer LIKE %(s)s 
                OR c.customer_name LIKE %(s)s 
                OR e.employee_name LIKE %(s)s 
                OR cp.mode_of_payment LIKE %(s)s 
                OR cp.memo LIKE %(s)s
            )""")
            params["s"] = search_pattern

        where_str = " AND ".join(where_clauses)

        summary_res = frappe.db.sql(f"""
            SELECT 
                COUNT(*) as total_count,
                SUM(cp.amount) as total_amount,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 1 THEN 1 ELSE 0 END) as reconciled_count,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 1 THEN cp.amount ELSE 0 END) as reconciled_amount,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 0 THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN COALESCE(cp.is_reconciled, 0) = 0 THEN cp.amount ELSE 0 END) as pending_amount
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            LEFT JOIN `tabEmployee` e ON cp.csa = e.name
            LEFT JOIN `tabShift` s ON cp.shift = s.name
            WHERE {where_str}
        """, params, as_dict=True)

        summary = summary_res[0] if summary_res else {}
        for k in ["total_count", "reconciled_count", "pending_count"]:
            summary[k] = int(summary.get(k) or 0)
        for k in ["total_amount", "reconciled_amount", "pending_amount"]:
            summary[k] = round(float(summary.get(k) or 0.0), 2)

        rows = frappe.db.sql(f"""
            SELECT 
                cp.name,
                cp.date,
                cp.shift,
                cp.trans_no,
                cp.customer,
                COALESCE(c.customer_name, cp.customer) as customer_name,
                cp.csa,
                COALESCE(e.employee_name, cp.csa) as csa_name,
                cp.mode_of_payment,
                cp.amount,
                cp.memo,
                COALESCE(cp.is_reconciled, 0) as is_reconciled,
                cp.reconciled_by,
                cp.reconciled_date
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            LEFT JOIN `tabEmployee` e ON cp.csa = e.name
            LEFT JOIN `tabShift` s ON cp.shift = s.name
            WHERE {where_str}
            ORDER BY cp.date DESC, cp.creation DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

        for r in rows:
            r["amount"] = round(float(r["amount"] or 0.0), 2)
            r["date_formatted"] = formatdate(r["date"])
            r["reconciled_date_formatted"] = frappe.utils.format_datetime(r["reconciled_date"]) if r.get("reconciled_date") else ""

        dropdown_where = "cp.customer IS NOT NULL AND cp.customer != ''"
        dropdown_params = {}
        if station and station not in ("ALL", "All Stations", ""):
            dropdown_where += " AND (s.station = %(station)s OR (cp.shift IS NULL AND c.station = %(station)s))"
            dropdown_params["station"] = station

        dropdown_options = frappe.db.sql(f"""
            SELECT DISTINCT cp.customer as id, COALESCE(c.customer_name, cp.customer) as label
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            LEFT JOIN `tabShift` s ON cp.shift = s.name
            WHERE {dropdown_where}
            ORDER BY label ASC
        """, dropdown_params, as_dict=True)

        return {
            "reconciliation_type": "customer_payments",
            "from_date": from_date,
            "to_date": to_date,
            "status": status,
            "records": rows,
            "summary": summary,
            "dropdown_options": dropdown_options,
            "page": page,
            "page_length": page_length,
            "total_pages": (summary["total_count"] + page_length - 1) // page_length if page_length else 1
        }

    # 2. Station Cards Reconciliation
    elif reconciliation_type == "station_cards":
        where_clauses = ["1=1"]
        params = {}

        if from_date:
            where_clauses.append("sc.date >= %(from_date)s")
            params["from_date"] = from_date
        if to_date:
            where_clauses.append("sc.date <= %(to_date)s")
            params["to_date"] = to_date

        if status == "pending":
            where_clauses.append("COALESCE(sc.is_reconciled, 0) = 0")
        elif status == "reconciled":
            where_clauses.append("COALESCE(sc.is_reconciled, 0) = 1")

        if party_or_card and party_or_card != "ALL":
            where_clauses.append("sc.card = %(card)s")
            params["card"] = party_or_card

        if station and station not in ("ALL", "All Stations", ""):
            where_clauses.append("s.station = %(station)s")
            params["station"] = station

        if search:
            search_pattern = f"%{search.strip()}%"
            where_clauses.append("""(
                sc.name LIKE %(s)s 
                OR sc.receipt_no LIKE %(s)s 
                OR sc.shift LIKE %(s)s 
                OR sc.card LIKE %(s)s 
                OR e.employee_name LIKE %(s)s 
                OR sc.memo LIKE %(s)s
            )""")
            params["s"] = search_pattern

        where_str = " AND ".join(where_clauses)

        summary_res = frappe.db.sql(f"""
            SELECT 
                COUNT(*) as total_count,
                SUM(sc.amount) as total_amount,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN 1 ELSE 0 END) as reconciled_count,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN sc.amount ELSE 0 END) as reconciled_amount,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN sc.amount ELSE 0 END) as pending_amount
            FROM `tabStation Cards` sc
            LEFT JOIN `tabEmployee` e ON sc.csa = e.name
            LEFT JOIN `tabShift` s ON sc.shift = s.name
            WHERE {where_str}
        """, params, as_dict=True)

        summary = summary_res[0] if summary_res else {}
        for k in ["total_count", "reconciled_count", "pending_count"]:
            summary[k] = int(summary.get(k) or 0)
        for k in ["total_amount", "reconciled_amount", "pending_amount"]:
            summary[k] = round(float(summary.get(k) or 0.0), 2)

        rows = frappe.db.sql(f"""
            SELECT 
                sc.name,
                sc.date,
                sc.shift,
                sc.receipt_no,
                sc.card,
                sc.csa,
                COALESCE(e.employee_name, sc.csa) as csa_name,
                sc.amount,
                sc.memo,
                COALESCE(sc.is_reconciled, 0) as is_reconciled,
                sc.reconciled_by,
                sc.reconciled_date
            FROM `tabStation Cards` sc
            LEFT JOIN `tabEmployee` e ON sc.csa = e.name
            LEFT JOIN `tabShift` s ON sc.shift = s.name
            WHERE {where_str}
            ORDER BY sc.date DESC, sc.creation DESC
            LIMIT %(limit)s OFFSET %(offset)s
        """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

        for r in rows:
            r["amount"] = round(float(r["amount"] or 0.0), 2)
            r["date_formatted"] = formatdate(r["date"])
            r["reconciled_date_formatted"] = frappe.utils.format_datetime(r["reconciled_date"]) if r.get("reconciled_date") else ""

        dropdown_where = "sc.card IS NOT NULL AND sc.card != ''"
        dropdown_params = {}
        if station and station not in ("ALL", "All Stations", ""):
            dropdown_where += " AND s.station = %(station)s"
            dropdown_params["station"] = station

        dropdown_options = frappe.db.sql(f"""
            SELECT DISTINCT sc.card as id, sc.card as label
            FROM `tabStation Cards` sc
            LEFT JOIN `tabShift` s ON sc.shift = s.name
            WHERE {dropdown_where}
            ORDER BY label ASC
        """, dropdown_params, as_dict=True)

        return {
            "reconciliation_type": "station_cards",
            "from_date": from_date,
            "to_date": to_date,
            "status": status,
            "records": rows,
            "summary": summary,
            "dropdown_options": dropdown_options,
            "page": page,
            "page_length": page_length,
            "total_pages": (summary["total_count"] + page_length - 1) // page_length if page_length else 1
        }


@frappe.whitelist()
def toggle_reconciliation_status(doctype, names, is_reconciled=1):
    """
    Updates reconciliation flag for selected transactions.
    """
    if isinstance(names, str):
        try:
            names = json.loads(names)
        except Exception:
            names = [n.strip() for n in names.split(",") if n.strip()]

    if not names:
        return {"success": False, "message": "No records specified"}

    is_reconciled = 1 if (str(is_reconciled).lower() in ["1", "true"]) else 0
    user = frappe.session.user if is_reconciled else ""
    user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user
    by_name = f"{user_fullname} ({user})" if is_reconciled else ""
    now_dt = frappe.utils.now_datetime() if is_reconciled else None

    table_name = "tabCustomer Payment" if doctype in ["Customer Payment", "customer_payments"] else "tabStation Cards"

    if len(names) == 1:
        frappe.db.sql(f"""
            UPDATE `{table_name}`
            SET is_reconciled = %s,
                reconciled_by = %s,
                reconciled_date = %s
            WHERE name = %s
        """, (is_reconciled, by_name, now_dt, names[0]))
    else:
        frappe.db.sql(f"""
            UPDATE `{table_name}`
            SET is_reconciled = %s,
                reconciled_by = %s,
                reconciled_date = %s
            WHERE name IN %s
        """, (is_reconciled, by_name, now_dt, tuple(names)))

    frappe.db.commit()

    return {
        "success": True,
        "is_reconciled": is_reconciled,
        "count": len(names),
        "reconciled_by": by_name,
        "reconciled_date": frappe.utils.format_datetime(now_dt) if now_dt else ""
    }


@frappe.whitelist()
def get_executive_accounts(station=None):
    """
    Returns classified Cash & Bank and Supplier accounts for Executive Panel sidebar.
    Filters dynamically by operating station context.
    """
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    raw_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type, parent_account
        FROM `tabAccount`
        WHERE is_group = 0 
          AND (account_type IN ('Cash', 'Bank') OR LOCATE('A/C', name) > 0 OR LOCATE('GALANA', name) > 0 OR LOCATE('RUBIS', name) > 0 OR LOCATE('Holding', name) > 0 OR LOCATE('Card', name) > 0 OR LOCATE('Top Up', name) > 0)
          AND company = %s
          AND docstatus < 2
        ORDER BY FIELD(account_type, 'Cash', 'Bank'), name
    """, (company,), as_dict=True)

    cash_bank = []
    holding_accounts = []
    suppliers = []

    for acc in raw_accounts:
        acc_name = acc["name"]
        short_name = acc["account_name"] or acc_name.replace(" - KIL", "")
        acc_type = acc["account_type"]
        upper_name = acc_name.upper()

        # Calculate current live balance
        bal = frappe.db.sql("""
            SELECT SUM(debit - credit)
            FROM `tabGL Entry`
            WHERE account = %s AND is_cancelled = 0
        """, (acc_name,))[0][0] or 0.0

        item = {
            "name": acc_name,
            "label": short_name,
            "account_type": acc_type,
            "current_balance": round(flt(bal), 2),
            "station": ""
        }

        # Determine station association
        if "GALANA" in upper_name:
            item["station"] = "Galana Annex"
        elif "RUBIS" in upper_name or "POA PLACE" in upper_name:
            item["station"] = "RUBIS POA PLACE"
        elif acc_name == "Shift Main Cash - KIL":
            item["station"] = "RUBIS POA PLACE"
        else:
            item["station"] = "" # Shared / General

        # Filter by station context if provided
        if station and station not in ("ALL", "All Stations", ""):
            # If account has station and doesn't match selected station, skip
            if item["station"] and item["station"].lower() != station.lower():
                continue

        # Separate Supplier Accounts, Holding Accounts, and Cash & Bank
        if "GALANA A/C" in upper_name or "RUBIS A/C" in upper_name or "SUPPLIER" in upper_name or acc_type == "Payable":
            suppliers.append(item)
        elif "HOLDING" in upper_name or "TOP UP" in upper_name or ("CARD" in upper_name and acc_type not in ("Cash", "Bank")):
            holding_accounts.append(item)
        elif acc_type in ("Cash", "Bank"):
            cash_bank.append(item)

    # 3. Query M-Pesa Tills individually with live operational balances
    mpesa_station_filter = ""
    mpesa_station_args = []
    if station and station not in ("ALL", "All Stations", ""):
        mpesa_station_filter = " AND station = %s"
        mpesa_station_args.append(station)

    active_tills = frappe.db.sql(f"""
        SELECT name, till_name, till_number, station, default_account, bank_account
        FROM `tabM-Pesa Till`
        WHERE is_active = 1 {mpesa_station_filter}
        ORDER BY station ASC, till_name ASC
    """, mpesa_station_args, as_dict=True)

    tills_list = []
    total_mpesa_balance = 0.0

    for t in active_tills:
        latest_reading = frappe.db.sql("""
            SELECT mp.closing_balance, mp.opening_balance, mp.amount, s.shift_date, s.status
            FROM `tabShift M-Pesa Payment` mp
            JOIN `tabShift` s ON s.name = mp.parent
            WHERE mp.mpesa_till = %s AND s.docstatus < 2
            ORDER BY s.shift_date DESC, s.creation DESC
            LIMIT 1
        """, (t.name,), as_dict=True)

        till_balance = 0.0
        last_date = None
        if latest_reading:
            r = latest_reading[0]
            last_date = r.shift_date
            if r.status == "Closed" or flt(r.closing_balance) > 0:
                till_balance = flt(r.closing_balance)
            else:
                till_balance = flt(r.opening_balance)

        till_balance = round(flt(till_balance), 2)
        total_mpesa_balance += till_balance

        tills_list.append({
            "name": t.name,
            "till_name": t.till_name or t.name,
            "till_number": t.till_number or "",
            "station": t.station or "",
            "current_balance": till_balance,
            "last_date": str(last_date) if last_date else "",
            "default_account": t.default_account or "",
            "bank_account": t.bank_account or ""
        })

    return {
        "cash_bank_accounts": cash_bank,
        "holding_accounts": holding_accounts,
        "supplier_accounts": suppliers,
        "mpesa_tills": tills_list,
        "total_mpesa_balance": round(flt(total_mpesa_balance), 2),
        "total_cash_balance": round(sum(flt(a["current_balance"]) for a in cash_bank), 2),
        "total_holding_balance": round(sum(flt(a["current_balance"]) for a in holding_accounts), 2)
    }


def enrich_cash_account_transactions(txns):
    """
    Enriches GL entries for Cash and Bank accounts so directors see crystal-clear,
    human-friendly descriptions (e.g. which customer paid, attendant cash remittances,
    till sweeps, expense payee, etc.) and category badges instead of raw technical memos.
    """
    if not txns:
        return

    import re

    shift_ids = set()
    emp_ids = set()
    pe_ids = set()

    for t in txns:
        rem = t.get("remarks") or ""
        m_shift = re.search(r'SHIFT-\d{2}-\d{2}-\d{2}-\d{4}', rem)
        if m_shift:
            shift_ids.add(m_shift.group(0))

        m_emp = re.search(r'HR-EMP-\d{4,5}', rem)
        if m_emp:
            emp_ids.add(m_emp.group(0))

        if t.get("party_type") == "Employee" and t.get("party"):
            emp_ids.add(t.get("party"))

        if t.get("voucher_type") == "Payment Entry" and t.get("voucher_no"):
            pe_ids.add(t.get("voucher_no"))

    # Bulk customer payments for shifts
    cp_by_shift_amt = {}
    if shift_ids:
        cps = frappe.db.sql("""
            SELECT cp.name, cp.shift, cp.customer, cp.amount, cp.mode_of_payment, cp.trans_no, 
                   COALESCE(c.customer_name, cp.customer) as customer_name
            FROM `tabCustomer Payment` cp
            LEFT JOIN `tabCustomer` c ON cp.customer = c.name
            WHERE cp.shift IN %s AND cp.docstatus < 2
        """, (list(shift_ids),), as_dict=True)
        for cp in cps:
            key = (cp.shift, round(flt(cp.amount), 2))
            cp_by_shift_amt.setdefault(key, []).append(cp)

    # Bulk employees
    emp_name_map = {}
    if emp_ids:
        emps = frappe.db.sql("""
            SELECT name, employee_name FROM `tabEmployee` WHERE name IN %s
        """, (list(emp_ids),), as_dict=True)
        emp_name_map = {e.name: e.employee_name for e in emps}

    # Bulk payment entries
    pe_map = {}
    if pe_ids:
        pes = frappe.db.sql("""
            SELECT name, party_type, party, party_name, payment_type, mode_of_payment, reference_no, remarks
            FROM `tabPayment Entry` WHERE name IN %s
        """, (list(pe_ids),), as_dict=True)
        pe_map = {p.name: p for p in pes}

    for t in txns:
        rem = (t.get("remarks") or "").strip()
        v_type = t.get("voucher_type") or ""
        v_no = t.get("voucher_no") or ""
        d = flt(t.get("debit"))
        c = flt(t.get("credit"))
        amt = round(d if d > 0 else c, 2)

        m_shift = re.search(r'SHIFT-\d{2}-\d{2}-\d{2}-\d{4}', rem)
        shift_id = m_shift.group(0) if m_shift else None

        category = "Other"
        category_color = "slate"
        clean_title = ""
        clean_subtitle = ""
        party_name = ""

        # 1. Payment Entry
        if v_type == "Payment Entry" and v_no in pe_map:
            pe = pe_map[v_no]
            p_type = pe.get("party_type") or "Party"
            p_name = pe.get("party_name") or pe.get("party") or ""
            party_name = p_name
            ref_no = pe.get("reference_no") or ""
            mop = pe.get("mode_of_payment") or ""
            pay_type = pe.get("payment_type") or ""

            if p_type == "Supplier":
                category = "Supplier Payment"
                category_color = "teal"
                clean_title = f"Supplier Payment: {p_name}"
            elif p_type == "Customer":
                category = "Customer Payment"
                category_color = "blue"
                clean_title = f"Customer Payment: {p_name}"
            else:
                category = f"{pay_type} Payment" if pay_type else "Payment Entry"
                category_color = "purple"
                clean_title = f"{p_type}: {p_name}"

            sub_parts = []
            if ref_no:
                sub_parts.append(f"Ref: {ref_no}")
            if mop:
                sub_parts.append(mop)
            clean_subtitle = " · ".join(sub_parts)

        # 2. Non-Cash Customer Payment (Shift Closure)
        elif "Customer Payment" in rem or "Clear Non-Cash Customer Payment" in rem:
            category = "Customer Payment"
            category_color = "blue"
            matched_cp = None
            if shift_id and (shift_id, amt) in cp_by_shift_amt:
                candidates = cp_by_shift_amt[(shift_id, amt)]
                if candidates:
                    matched_cp = candidates[0]
                    for cand in candidates:
                        if cand.mode_of_payment and cand.mode_of_payment.lower() in rem.lower():
                            matched_cp = cand
                            break

            if matched_cp:
                party_name = matched_cp.customer_name
                clean_title = f"Customer: {matched_cp.customer_name}"
                sub_parts = []
                if matched_cp.trans_no:
                    sub_parts.append(f"Ref: {matched_cp.trans_no}")
                if matched_cp.mode_of_payment:
                    sub_parts.append(matched_cp.mode_of_payment)
                if shift_id:
                    sub_parts.append(f"Shift {shift_id}")
                clean_subtitle = " · ".join(sub_parts)
            else:
                # Check if remark already has Customer Payment: {Customer} (from updated shift closure)
                m_cp_rem = re.search(r'Customer Payment:\s*([^v]+)via\s*([^(]+)(?:\(Ref:\s*([^)]+)\))?', rem)
                if m_cp_rem:
                    party_name = m_cp_rem.group(1).strip()
                    mop_name = m_cp_rem.group(2).strip()
                    ref_name = m_cp_rem.group(3).strip() if m_cp_rem.group(3) else ""
                    clean_title = f"Customer: {party_name}"
                    sub_parts = []
                    if ref_name:
                        sub_parts.append(f"Ref: {ref_name}")
                    if mop_name:
                        sub_parts.append(mop_name)
                    if shift_id:
                        sub_parts.append(f"Shift {shift_id}")
                    clean_subtitle = " · ".join(sub_parts)
                else:
                    mop_str = rem.split("via")[-1].split("\n")[0].split("·")[0].strip() if "via" in rem else "Non-Cash"
                    clean_title = f"Customer Payment via {mop_str}"
                    clean_subtitle = f"Shift {shift_id}" if shift_id else ""

        # 3. Forecourt Cash Submission by CSA
        elif "Cash Submitted by" in rem:
            category = "Forecourt Cash"
            category_color = "emerald"
            part = rem.split("Cash Submitted by")[-1]
            raw_name = part.split("\n")[0].split(".")[0].split("·")[0].strip()
            name = emp_name_map.get(raw_name, raw_name)
            party_name = name
            clean_title = f"Forecourt Cash: {name}" if name else "Forecourt Cash Submission"
            clean_subtitle = f"Shift {shift_id}" if shift_id else ""

        # 4. Till Sweep / Bank Transfer from Till
        elif "Bank Transfer from" in rem or "Till Sweep" in rem:
            category = "Till Sweep"
            category_color = "indigo"
            part = rem.split("Bank Transfer from")[-1] if "Bank Transfer from" in rem else rem
            till = part.split("\n")[0].split(".")[0].split("·")[0].strip()
            clean_title = f"Till Sweep: {till}"
            clean_subtitle = f"Shift {shift_id}" if shift_id else ""

        # 5. Account Transfer (Inter-account transfer or sweep)
        elif "[ACCOUNT TRANSFER]" in rem or "Transfer Between Accounts" in rem:
            category = "Account Transfer"
            category_color = "purple"
            clean_title = "Account Transfer"
            sub_text = rem
            if "Transfer KES" in rem:
                m_txt = re.search(r'Transfer KES [^ ]+ from (.*)', rem)
                if m_txt:
                    sub_text = m_txt.group(1).split(". Ref:")[0]
            clean_subtitle = sub_text.replace("\n", " · ")[:90]

        # 6. Executive / Director Expense
        elif "[EXECUTIVE EXPENSE]" in rem:
            category = "Director Expense"
            category_color = "rose"
            m_payee = re.search(r'Payee:\s*([^|\n]+)', rem)
            payee = m_payee.group(1).strip() if m_payee else ""
            m_note = re.search(r'\[EXECUTIVE EXPENSE\]\s*([^|\n]+)', rem)
            note = m_note.group(1).strip() if m_note else ""
            m_ref = re.search(r'Ref:\s*([^|\n]+)', rem)
            ref = m_ref.group(1).strip() if m_ref else ""
            party_name = payee
            clean_title = f"Expense: {payee}" if payee else "Executive Expense"
            sub_parts = []
            if note:
                sub_parts.append(note)
            if ref:
                sub_parts.append(f"Ref: {ref}")
            clean_subtitle = " · ".join(sub_parts)

        # 7. Supplier Cash Top-Up
        elif "Supplier Cash Top-Ups" in rem or "Supplier Top-Ups" in rem:
            category = "Supplier Top-Up"
            category_color = "teal"
            against_supp = t.get("against") or ""
            clean_title = f"Supplier Top-Up: {against_supp}" if against_supp else "Supplier Cash Top-Up"
            clean_subtitle = f"Shift {shift_id}" if shift_id else ""

        # 8. Petty Cash Entry
        elif "Petty Cash" in rem:
            category = "Petty Cash"
            category_color = "amber"
            m_item = re.search(r'Petty Cash \(([^)]+)\)', rem)
            item = m_item.group(1).strip() if m_item else ""
            m_paid = re.search(r'Paid by ([^·\n]+)', rem)
            paid_by = m_paid.group(1).strip() if m_paid else ""
            party_name = paid_by
            clean_title = f"Petty Cash: {item}" if item else "Petty Cash Expense"
            sub_parts = []
            if paid_by:
                sub_parts.append(f"Paid by {paid_by}")
            if shift_id:
                sub_parts.append(f"Shift {shift_id}")
            clean_subtitle = " · ".join(sub_parts)

        # 9. Shortage Recovery / Payment
        elif "Shortage Payment" in rem or "Shortage Recovery" in rem or "Shortage for" in rem:
            category = "Shortage Recovery"
            category_color = "cyan"
            m_emp = re.search(r'from (HR-EMP-\d{4,5})', rem)
            emp_code = m_emp.group(1) if m_emp else ""
            emp_name = emp_name_map.get(emp_code, emp_code)
            party_name = emp_name
            clean_title = f"Shortage Recovery: {emp_name}" if emp_name else "Shortage Recovery"
            m_sref = re.search(r'Ref:\s*([^)]+)', rem)
            clean_subtitle = f"Ref: {m_sref.group(1)}" if m_sref else (f"Shift {shift_id}" if shift_id else "")

        # 10. Reversal / Cancellation
        elif "On cancellation of" in rem:
            category = "Reversal"
            category_color = "slate"
            cancelled_v = rem.split()[-1] if rem.split() else ""
            clean_title = f"Cancellation Reversal ({cancelled_v})"
            clean_subtitle = f"Cancelled voucher {cancelled_v}"

        # 11. Generic / Fallback
        else:
            first_line = rem.split("\n")[0].split("·")[0].strip()
            clean_title = first_line if first_line else f"{v_type} {v_no}"
            if shift_id:
                clean_subtitle = f"Shift {shift_id}"
            elif t.get("against"):
                clean_subtitle = f"Against: {t.get('against')}"[:70]

        t["category"] = category
        t["category_color"] = category_color
        t["clean_title"] = clean_title
        t["clean_subtitle"] = clean_subtitle
        t["party_name"] = party_name


@frappe.whitelist()
def get_cash_accounts_overview(account=None, from_date=None, to_date=None, search=None, is_supplier=0):
    """
    Returns ledger, balances, and breakdown for Cash, Bank, or Supplier accounts.
    """
    from frappe.utils import cint
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = frappe.utils.add_days(to_date, -6)

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    is_supp = cint(is_supplier) or False
    if account:
        acc_upper = account.upper()
        if "GALANA A/C" in acc_upper or "RUBIS A/C" in acc_upper or "SUPPLIER" in acc_upper:
            is_supp = True

    # Determine default account if not supplied
    if not account:
        if is_supp:
            account = "GALANA A/C - KIL" if frappe.db.exists("Account", "GALANA A/C - KIL") else "RUBIS A/C - KIL"
        else:
            account = "Shift Main Cash - KIL"

    # Filter out unposted shift-closure cards for supplier accounts so only posted remittances appear
    supp_gl_clause = ""
    if is_supp:
        supp_gl_clause = " AND NOT (remarks LIKE 'Card Payment: Station Card%%' OR remarks LIKE 'Clear Non-Cash Customer Payment via Rubis Card%%') "

    # Opening balance for selected account
    opening_bal = frappe.db.sql(f"""
        SELECT SUM(debit - credit)
        FROM `tabGL Entry`
        WHERE account = %s AND posting_date < %s AND is_cancelled = 0
          {supp_gl_clause}
    """, (account, from_date))[0][0] or 0.0
    opening_bal = round(flt(opening_bal), 2)

    # Period totals
    period_sums = frappe.db.sql(f"""
        SELECT SUM(debit) as total_in, SUM(credit) as total_out, COUNT(name) as total_txns
        FROM `tabGL Entry`
        WHERE account = %s 
          AND posting_date >= %s AND posting_date <= %s 
          AND is_cancelled = 0
          {supp_gl_clause}
    """, (account, from_date, to_date), as_dict=True)[0]

    total_in = round(flt(period_sums.total_in or 0.0), 2)
    total_out = round(flt(period_sums.total_out or 0.0), 2)
    net_change = round(total_in - total_out, 2)
    closing_bal = round(opening_bal + net_change, 2)

    # Transactions list
    where_extra = ""
    params = [account, from_date, to_date]
    if search:
        where_extra = " AND (voucher_no LIKE %s OR remarks LIKE %s OR against LIKE %s) "
        s_term = f"%{search}%"
        params.extend([s_term, s_term, s_term])

    txns = frappe.db.sql(f"""
        SELECT 
            name, posting_date, voucher_type, voucher_no, 
            debit, credit, against, remarks, creation,
            party_type, party
        FROM `tabGL Entry`
        WHERE account = %s 
          AND posting_date >= %s AND posting_date <= %s 
          AND is_cancelled = 0
          {supp_gl_clause}
          {where_extra}
        ORDER BY posting_date ASC, creation ASC, name ASC
    """, tuple(params), as_dict=True)

    enrich_cash_account_transactions(txns)

    running = opening_bal
    for t in txns:
        d = flt(t["debit"])
        c = flt(t["credit"])
        running += (d - c)
        t["running_balance"] = round(running, 2)
        t["debit"] = round(d, 2)
        t["credit"] = round(c, 2)
        t["date_formatted"] = formatdate(t["posting_date"])
        t["time_formatted"] = str(t.get("creation") or "")[11:19]

    # Reverse to show most recent first in UI
    txns.reverse()

    return {
        "account": account,
        "from_date": from_date,
        "to_date": to_date,
        "opening_balance": opening_bal,
        "total_inflows": total_in,
        "total_outflows": total_out,
        "total_debits": total_in,      # Payments Made
        "total_credits": total_out,    # Deliveries / Invoices
        "net_change": net_change,
        "closing_balance": closing_bal,
        "total_txns": len(txns),
        "transactions": txns,
        "is_supplier": is_supp
    }


@frappe.whitelist()
def get_director_expense_form_options():
    """
    Returns lists of available expense accounts and cash/bank accounts for the Director Expense form.
    """
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # Active leaf Expense Accounts
    expense_accounts = frappe.db.sql("""
        SELECT name, account_name
        FROM `tabAccount`
        WHERE is_group = 0 
          AND root_type = 'Expense'
          AND company = %s
          AND docstatus < 2
        ORDER BY account_name ASC
    """, (company,), as_dict=True)

    # Active leaf Cash & Bank Accounts
    payment_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 
          AND account_type IN ('Cash', 'Bank')
          AND company = %s
          AND docstatus < 2
        ORDER BY FIELD(account_type, 'Cash', 'Bank'), name ASC
    """, (company,), as_dict=True)

    return {
        "company": company,
        "expense_accounts": expense_accounts,
        "payment_accounts": payment_accounts
    }


@frappe.whitelist()
def submit_director_expense(date=None, paid_from_account=None, expense_account=None, amount=None, payee=None, description=None, reference_no=None):
    """
    Creates and submits a Journal Entry for director/executive expenses.
    Keeps it confidential and separated from Shift Operations SPA.
    """
    if not amount or flt(amount) <= 0:
        frappe.throw("Please enter a valid expense amount greater than 0.")
    if not paid_from_account:
        frappe.throw("Please select the Paid From account (Cash or Bank).")
    if not expense_account:
        frappe.throw("Please select the Expense Account / Category.")
    if not payee or not payee.strip():
        frappe.throw("Please specify the Payee / Beneficiary.")
    if not description or not description.strip():
        frappe.throw("Please provide an Expense Description / Business Purpose.")

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    posting_date = date or today()
    val_amount = flt(amount)

    user_remark = f"[EXECUTIVE EXPENSE] {description.strip()} | Payee: {payee.strip()}"
    if reference_no and reference_no.strip():
        user_remark += f" | Ref: {reference_no.strip()}"

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = posting_date
    je.user_remark = user_remark

    # Debit line: Expense Account
    je.append("accounts", {
        "account": expense_account,
        "debit_in_account_currency": val_amount,
        "credit_in_account_currency": 0.0,
        "user_remark": f"{payee} - {description}"
    })

    # Credit line: Cash / Bank Account
    je.append("accounts", {
        "account": paid_from_account,
        "debit_in_account_currency": 0.0,
        "credit_in_account_currency": val_amount,
        "user_remark": f"{payee} - {description}"
    })

    je.insert()
    je.submit()

    return {
        "success": True,
        "voucher_no": je.name,
        "amount": val_amount,
        "payee": payee,
        "posting_date": formatdate(posting_date),
        "message": f"Director Expense of KES {val_amount:,.2f} recorded and posted successfully ({je.name})."
    }


@frappe.whitelist()
def delete_director_expense(voucher_no):
    """
    Cancels and deletes an executive director expense Journal Entry,
    reversing all General Ledger impacts and restoring cash/bank balances.
    """
    if not voucher_no:
        frappe.throw("Voucher No is required.")

    if not frappe.db.exists("Journal Entry", voucher_no):
        frappe.throw(f"Journal Entry {voucher_no} does not exist.")

    je = frappe.get_doc("Journal Entry", voucher_no)

    # Cancel if submitted to reverse GL entries cleanly
    if je.docstatus == 1:
        je.cancel()

    # Delete the Journal Entry record
    frappe.delete_doc("Journal Entry", voucher_no, force=1, ignore_permissions=True)
    frappe.db.commit()

    return {
        "success": True,
        "voucher_no": voucher_no,
        "message": f"Expense voucher {voucher_no} deleted and cancelled successfully."
    }


@frappe.whitelist()
def update_director_expense(voucher_no, date, paid_from_account, expense_account, amount, payee, description, reference_no=None):
    """
    Updates an executive director expense by cancelling & replacing the Journal Entry
    with updated date, accounts, amount, payee, and description.
    """
    if not voucher_no:
        frappe.throw("Voucher No is required.")

    if not flt(amount) or flt(amount) <= 0:
        frappe.throw("Amount must be greater than zero.")
    if not paid_from_account:
        frappe.throw("Paid From (Cash / Bank) account is required.")
    if not expense_account:
        frappe.throw("Expense Category / Account is required.")
    if not payee or not payee.strip():
        frappe.throw("Please provide the Payee / Beneficiary.")
    if not description or not description.strip():
        frappe.throw("Please provide an Expense Description / Business Purpose.")

    if not frappe.db.exists("Journal Entry", voucher_no):
        frappe.throw(f"Journal Entry {voucher_no} does not exist.")

    old_je = frappe.get_doc("Journal Entry", voucher_no)
    company = old_je.company or frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # Cancel and delete old Journal Entry
    if old_je.docstatus == 1:
        old_je.cancel()
    frappe.delete_doc("Journal Entry", voucher_no, force=1, ignore_permissions=True)

    # Post new updated Journal Entry
    posting_date = date or today()
    val_amount = flt(amount)

    user_remark = f"[EXECUTIVE EXPENSE] {description.strip()} | Payee: {payee.strip()}"
    if reference_no and reference_no.strip():
        user_remark += f" | Ref: {reference_no.strip()}"

    new_je = frappe.new_doc("Journal Entry")
    new_je.voucher_type = "Journal Entry"
    new_je.company = company
    new_je.posting_date = posting_date
    new_je.user_remark = user_remark

    # Debit line: Expense Account
    new_je.append("accounts", {
        "account": expense_account,
        "debit_in_account_currency": val_amount,
        "credit_in_account_currency": 0.0,
        "user_remark": f"{payee} - {description}"
    })

    # Credit line: Cash / Bank Account
    new_je.append("accounts", {
        "account": paid_from_account,
        "debit_in_account_currency": 0.0,
        "credit_in_account_currency": val_amount,
        "user_remark": f"{payee} - {description}"
    })

    new_je.insert()
    new_je.submit()
    frappe.db.commit()

    return {
        "success": True,
        "voucher_no": new_je.name,
        "amount": val_amount,
        "payee": payee,
        "posting_date": formatdate(posting_date),
        "message": f"Director Expense updated and posted successfully ({new_je.name})."
    }


@frappe.whitelist()
def get_director_expenses_register(from_date=None, to_date=None, expense_account=None, paid_from_account=None, search=None):
    """
    Returns list of director/corporate expenses recorded via Journal Entry.
    """
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = frappe.utils.add_days(to_date, -29)

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    conditions = [
        "je.docstatus = 1", 
        "je.company = %(company)s", 
        "je.posting_date >= %(from_date)s", 
        "je.posting_date <= %(to_date)s"
    ]
    params = {
        "company": company,
        "from_date": from_date,
        "to_date": to_date
    }

    # Tag filter or non-shift, non-customer/shortage JEs
    conditions.append("(je.user_remark LIKE '%%[EXECUTIVE EXPENSE]%%' OR (je.user_remark NOT LIKE '%%Shift%%' AND je.user_remark NOT LIKE '%%Customer Payment%%' AND je.user_remark NOT LIKE '%%Shortage Payment%%'))")

    if search:
        conditions.append("(je.name LIKE %(search)s OR je.user_remark LIKE %(search)s)")
        params["search"] = f"%{search}%"

    cond_sql = " AND ".join(conditions)

    jes = frappe.db.sql(f"""
        SELECT 
            je.name as voucher_no,
            je.posting_date,
            je.user_remark,
            je.total_debit as amount,
            je.owner,
            je.creation
        FROM `tabJournal Entry` je
        WHERE {cond_sql}
        ORDER BY je.posting_date DESC, je.creation DESC
    """, params, as_dict=True)

    voucher_names = [j["voucher_no"] for j in jes]
    lines_by_voucher = {}
    if voucher_names:
        lines = frappe.db.sql("""
            SELECT 
                parent, account, debit, credit, user_remark
            FROM `tabJournal Entry Account`
            WHERE parent IN %s
            ORDER BY parent, idx
        """, (tuple(voucher_names),), as_dict=True)
        for l in lines:
            lines_by_voucher.setdefault(l["parent"], []).append(l)

    filtered_results = []
    total_expense = 0.0
    cash_expense = 0.0
    bank_expense = 0.0
    category_totals = {}

    for j in jes:
        acct_lines = lines_by_voucher.get(j["voucher_no"], [])

        exp_acc = None
        paid_acc = None
        for l in acct_lines:
            if flt(l.get("debit")) > 0:
                exp_acc = l.get("account")
            elif flt(l.get("credit")) > 0:
                paid_acc = l.get("account")

        if expense_account and exp_acc != expense_account:
            continue
        if paid_from_account and paid_acc != paid_from_account:
            continue

        amt = flt(j["amount"])
        total_expense += amt

        if paid_acc and "Cash" in paid_acc:
            cash_expense += amt
        else:
            bank_expense += amt

        if exp_acc:
            category_totals[exp_acc] = category_totals.get(exp_acc, 0.0) + amt

        raw_remark = j.get("user_remark") or ""
        clean_desc = raw_remark.replace("[EXECUTIVE EXPENSE]", "").strip()
        payee = ""
        ref_no = ""
        desc = clean_desc

        if " | Payee: " in clean_desc:
            parts = clean_desc.split(" | Payee: ")
            desc = parts[0].strip()
            rest = parts[1]
            if " | Ref: " in rest:
                p_parts = rest.split(" | Ref: ")
                payee = p_parts[0].strip()
                ref_no = p_parts[1].strip()
            else:
                payee = rest.strip()
        elif "Payee: " in clean_desc:
            parts = clean_desc.split("Payee: ")
            payee = parts[1].split("|")[0].strip()

        owner_name = frappe.get_cached_value("User", j["owner"], "full_name") or j["owner"]

        filtered_results.append({
            "voucher_no": j["voucher_no"],
            "posting_date": j["posting_date"],
            "date_formatted": formatdate(j["posting_date"]),
            "expense_account": exp_acc or "Unclassified",
            "paid_from_account": paid_acc or "General Cash/Bank",
            "amount": round(amt, 2),
            "payee": payee or "Not specified",
            "description": desc or clean_desc,
            "reference_no": ref_no or "-",
            "owner": owner_name,
            "raw_remark": raw_remark
        })

    top_cat = "None"
    top_cat_amt = 0.0
    for cat, c_amt in category_totals.items():
        if c_amt > top_cat_amt:
            top_cat_amt = c_amt
            top_cat = cat.replace(" - KIL", "")

    summary = {
        "total_expense": round(total_expense, 2),
        "cash_expense": round(cash_expense, 2),
        "bank_expense": round(bank_expense, 2),
        "count": len(filtered_results),
        "top_category": top_cat,
        "top_category_amount": round(top_cat_amt, 2)
    }

    return {
        "from_date": from_date,
        "to_date": to_date,
        "summary": summary,
        "records": filtered_results
    }


@frappe.whitelist()
def get_cards_holding_data(from_date=None, to_date=None, card_type=None, status=None, search=None, page=1, page_length=50, station=None):
    """
    Returns station cards from SPA for Cards Holding Account review, summary, and posting.
    """
    from frappe.utils import formatdate, cint, flt
    import json

    page = max(cint(page), 1)
    page_length = cint(page_length) or 50
    offset = (page - 1) * page_length

    where_clauses = ["1=1"]
    params = {}

    if from_date:
        where_clauses.append("sc.date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        where_clauses.append("sc.date <= %(to_date)s")
        params["to_date"] = to_date

    if card_type and card_type != "ALL":
        where_clauses.append("sc.card = %(card_type)s")
        params["card_type"] = card_type

    if station and station not in ("ALL", "All Stations", ""):
        where_clauses.append("s.station = %(station)s")
        params["station"] = station

    if status == "pending":
        where_clauses.append("COALESCE(sc.is_reconciled, 0) = 0")
    elif status == "posted":
        where_clauses.append("COALESCE(sc.is_reconciled, 0) = 1")

    if search:
        search_pattern = f"%{search.strip()}%"
        where_clauses.append("""(
            sc.name LIKE %(s)s 
            OR sc.receipt_no LIKE %(s)s 
            OR sc.shift LIKE %(s)s 
            OR sc.card LIKE %(s)s 
            OR e.employee_name LIKE %(s)s 
            OR sc.memo LIKE %(s)s
        )""")
        params["s"] = search_pattern

    where_str = " AND ".join(where_clauses)

    # 1. Summary Query
    summary_res = frappe.db.sql(f"""
        SELECT 
            COUNT(*) as total_count,
            SUM(sc.amount) as total_amount,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN 1 ELSE 0 END) as posted_count,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 1 THEN sc.amount ELSE 0 END) as posted_amount,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN COALESCE(sc.is_reconciled, 0) = 0 THEN sc.amount ELSE 0 END) as pending_amount
        FROM `tabStation Cards` sc
        LEFT JOIN `tabEmployee` e ON sc.csa = e.name
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {where_str}
    """, params, as_dict=True)

    summary = summary_res[0] if summary_res else {}
    for k in ["total_count", "posted_count", "pending_count"]:
        summary[k] = int(summary.get(k) or 0)
    for k in ["total_amount", "posted_amount", "pending_amount"]:
        summary[k] = round(float(summary.get(k) or 0.0), 2)

    # Live holding balances per card brand (including station-specific accounts)
    holding_bals = {}
    for h_name, h_key in [
        ("Rubis Cards Holding Account - KIL", "rubis_bal"),
        ("Galana Cards Holding Account - KIL", "galana_bal"),
        (["KCB Cards Holding Account - KIL", "KCB Cards Holding - Rubis - KIL", "KCB Cards Holding - Galana - KIL"], "kcb_bal"),
        (["Equity Cards Holding Account - KIL", "Equity Cards Holding - Rubis - KIL", "Equity Cards Holding - Galana - KIL"], "equity_bal")
    ]:
        if isinstance(h_name, list):
            b = frappe.db.sql("""
                SELECT SUM(debit - credit) FROM `tabGL Entry` WHERE account IN %s AND is_cancelled = 0
            """, (tuple(h_name),))[0][0] or 0.0
        else:
            b = frappe.db.sql("""
                SELECT SUM(debit - credit) FROM `tabGL Entry` WHERE account = %s AND is_cancelled = 0
            """, (h_name,))[0][0] or 0.0
        holding_bals[h_key] = round(float(b), 2)
    summary["holding_balances"] = holding_bals

    # 2. Paginated rows
    rows = frappe.db.sql(f"""
        SELECT 
            sc.name,
            sc.date,
            sc.shift,
            sc.receipt_no,
            sc.card,
            sc.csa,
            COALESCE(e.employee_name, sc.csa) as csa_name,
            sc.amount,
            sc.memo,
            COALESCE(sc.is_reconciled, 0) as is_reconciled,
            sc.reconciled_by,
            sc.reconciled_date
        FROM `tabStation Cards` sc
        LEFT JOIN `tabEmployee` e ON sc.csa = e.name
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {where_str}
        ORDER BY sc.date ASC, sc.creation ASC, sc.name ASC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

    for r in rows:
        r["amount"] = round(float(r["amount"] or 0.0), 2)
        r["date_formatted"] = formatdate(r["date"])
        r["reconciled_date_formatted"] = frappe.utils.format_datetime(r["reconciled_date"]) if r.get("reconciled_date") else ""

    # Available Card Types for dropdown
    ct_where = "sc.card IS NOT NULL AND sc.card != ''"
    ct_params = {}
    if station and station not in ("ALL", "All Stations", ""):
        ct_where += " AND s.station = %(station)s"
        ct_params["station"] = station

    card_types = frappe.db.sql(f"""
        SELECT DISTINCT sc.card as id, sc.card as label
        FROM `tabStation Cards` sc
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {ct_where}
        ORDER BY sc.card ASC
    """, ct_params, as_dict=True)

    # Available Supplier / Bank Accounts for posting dialog
    supplier_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 AND (
            name LIKE '%RUBIS%' 
            OR name LIKE '%CARD%' 
            OR name LIKE '%Creditor%'
            OR account_type IN ('Bank', 'Cash', 'Payable', 'Current Asset')
        )
        ORDER BY name ASC
    """, as_dict=True)

    return {
        "from_date": from_date,
        "to_date": to_date,
        "status": status,
        "card_type": card_type,
        "summary": summary,
        "records": rows,
        "card_types": card_types,
        "supplier_accounts": supplier_accounts,
        "page": page,
        "page_length": page_length,
        "total_pages": (summary["total_count"] + page_length - 1) // page_length if page_length else 1
    }


@frappe.whitelist()
def post_station_cards_to_supplier(card_names, supplier_account, posting_date=None, credited_amount=None, reference=None, variance_account=None, notes=None, create_gl_entry=1):
    """
    Posts selected station cards from holding to the supplier account with the amount actually credited.
    """
    from frappe.utils import now_datetime, flt, cint, today
    import json

    if isinstance(card_names, str):
        try:
            card_names = json.loads(card_names)
        except Exception:
            card_names = [n.strip() for n in card_names.split(",") if n.strip()]

    if not card_names:
        frappe.throw("No station cards selected for posting")

    if not supplier_account:
        frappe.throw("Please specify the Supplier Account that was credited")

    posting_date = posting_date or today()
    cards = frappe.get_all("Station Cards", filters={"name": ["in", card_names]}, fields=["name", "amount", "card", "receipt_no", "memo"])
    if not cards:
        frappe.throw("Selected cards not found in the system")

    cards_total = sum([flt(c.amount) for c in cards])
    credited_amt = flt(credited_amount) if (credited_amount is not None and str(credited_amount).strip() != "") else cards_total
    user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user
    by_name = f"{user_fullname} ({frappe.session.user})"
    now_dt = now_datetime()

    jv_name = None
    if cint(create_gl_entry) != 0:
        company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
        source_account = "Cards Holding Account - KIL" if frappe.db.exists("Account", "Cards Holding Account - KIL") else "Shift Control Account - KIL"

        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = company
        je.posting_date = posting_date
        je.cheque_no = reference or f"CARDS-{len(cards)}"
        je.user_remark = f"[STATION CARDS POSTING] Posted {len(cards)} station cards (SPA Total: KES {cards_total:,.2f}) to Supplier Account: {supplier_account}. Credited: KES {credited_amt:,.2f}. {notes or ''}".strip()

        # Debit: Supplier account with credited amount
        supp_row = {
            "account": supplier_account,
            "debit_in_account_currency": credited_amt,
            "user_remark": f"Supplier Credit ({reference or 'Station Cards'})"
        }
        acc_type = frappe.db.get_value("Account", supplier_account, "account_type")
        if acc_type == "Payable":
            supp_row["party_type"] = "Supplier"
            supp_row["party"] = "RUBIS KENYA" if "RUBIS" in supplier_account.upper() else (frappe.get_all("Supplier", limit=1)[0].name if frappe.get_all("Supplier", limit=1) else None)
        je.append("accounts", supp_row)

        # Variance / Commission handling if credited differs from cards total
        variance = round(cards_total - credited_amt, 2)
        if variance > 0:
            var_acc = variance_account or "Commission on Sales - KIL"
            if not frappe.db.exists("Account", var_acc):
                var_acc = "Administrative Expenses - KIL"
            je.append("accounts", {
                "account": var_acc,
                "debit_in_account_currency": variance,
                "user_remark": "Card Processing Fee / Commission"
            })
        elif variance < 0:
            var_acc = variance_account or "Discounts Allowed - KIL"
            if not frappe.db.exists("Account", var_acc):
                var_acc = "Miscellaneous Expenses - KIL"
            je.append("accounts", {
                "account": var_acc,
                "credit_in_account_currency": abs(variance),
                "user_remark": "Supplier Bonus / Overage"
            })

        # Credit: Source Card Holding Accounts (specific to card brand)
        company_abbr = frappe.get_cached_value('Company', company, 'abbr') or "KIL"
        holding_map = {}
        for c in cards:
            c_name = c.get("card") or ""
            c_upper = c_name.upper()
            st_name = (c.get("station") or "").upper()
            if not st_name and c.get("shift"):
                st_name = (frappe.db.get_value("Shift", c.get("shift"), "station") or "").upper()
            is_rub = "RUBIS" in st_name
            is_gal = "GALANA" in st_name

            if "RUBIS" in c_upper:
                acc = f"Rubis Cards Holding Account - {company_abbr}"
            elif "GALANA" in c_upper:
                acc = f"Galana Cards Holding Account - {company_abbr}"
            elif "KCB" in c_upper:
                if is_rub and frappe.db.exists("Account", f"KCB Cards Holding - Rubis - {company_abbr}"):
                    acc = f"KCB Cards Holding - Rubis - {company_abbr}"
                elif is_gal and frappe.db.exists("Account", f"KCB Cards Holding - Galana - {company_abbr}"):
                    acc = f"KCB Cards Holding - Galana - {company_abbr}"
                else:
                    acc = f"KCB Cards Holding Account - {company_abbr}"
            elif "EQUITY" in c_upper:
                if is_rub and frappe.db.exists("Account", f"Equity Cards Holding - Rubis - {company_abbr}"):
                    acc = f"Equity Cards Holding - Rubis - {company_abbr}"
                elif is_gal and frappe.db.exists("Account", f"Equity Cards Holding - Galana - {company_abbr}"):
                    acc = f"Equity Cards Holding - Galana - {company_abbr}"
                else:
                    acc = f"Equity Cards Holding Account - {company_abbr}"
            else:
                acc = f"Cards Holding Account - {company_abbr}"

            if not frappe.db.exists("Account", acc):
                acc = "Cards Holding Account - KIL" if frappe.db.exists("Account", "Cards Holding Account - KIL") else "Shift Control Account - KIL"

            holding_map[acc] = round(holding_map.get(acc, 0.0) + flt(c.get("amount")), 2)

        for h_acc, h_amt in holding_map.items():
            je.append("accounts", {
                "account": h_acc,
                "credit_in_account_currency": h_amt,
                "user_remark": f"Clear Holding: {h_acc} ({len(cards)} cards)"
            })

        je.flags.ignore_permissions = True
        je.insert()
        je.submit()
        jv_name = je.name

    # Update Station Cards status
    memo_suffix = f" [Posted to {supplier_account}: KES {credited_amt:,.2f} on {posting_date}{(' (Ref: ' + str(reference) + ')') if reference else ''}{(' (JV: ' + str(jv_name) + ')') if jv_name else ''}]"

    frappe.db.sql("""
        UPDATE `tabStation Cards`
        SET is_reconciled = 1,
            reconciled_by = %s,
            reconciled_date = %s,
            memo = CONCAT(IFNULL(memo, ''), %s)
        WHERE name IN %s
    """, (by_name, now_dt, memo_suffix, tuple(card_names)))

    frappe.db.commit()

    return {
        "success": True,
        "message": f"Successfully posted {len(card_names)} cards (KES {cards_total:,.2f}) to {supplier_account}!",
        "count": len(card_names),
        "total_amount": cards_total,
        "credited_amount": credited_amt,
        "supplier_account": supplier_account,
        "journal_entry": jv_name
    }


@frappe.whitelist()
def undo_station_cards_posting(card_names):
    """
    Reverts station cards back to pending holding status.
    """
    import json
    if isinstance(card_names, str):
        try:
            card_names = json.loads(card_names)
        except Exception:
            card_names = [n.strip() for n in card_names.split(",") if n.strip()]

    if not card_names:
        frappe.throw("No station cards specified")

    frappe.db.sql("""
        UPDATE `tabStation Cards`
        SET is_reconciled = 0,
            reconciled_by = NULL,
            reconciled_date = NULL
        WHERE name IN %s
    """, (tuple(card_names),))

    frappe.db.commit()
    return {"success": True, "message": f"{len(card_names)} card(s) reverted to pending in holding."}


@frappe.whitelist()
def auto_match_cards_to_amount(target_amount, selected_card_names=None, from_date=None, to_date=None, card_type=None, station=None):
    """
    Finds and selects cards from holding in chronological order (earliest date first)
    to match the specified supplier statement remittance amount.
    """
    from frappe.utils import flt, cint
    import json

    target_amt = round(flt(target_amount), 2)
    if target_amt <= 0:
        frappe.throw("Please enter a valid positive statement amount.")

    if isinstance(selected_card_names, str):
        try:
            selected_card_names = json.loads(selected_card_names)
        except Exception:
            selected_card_names = [n.strip() for n in selected_card_names.split(",") if n.strip()]
    selected_card_names = selected_card_names or []

    # Get already selected cards sum
    already_selected_sum = 0.0
    if selected_card_names:
        already_selected_sum = flt(frappe.db.sql("""
            SELECT SUM(amount) FROM `tabStation Cards` WHERE name IN %s
        """, (tuple(selected_card_names),))[0][0] or 0.0)

    needed_amt = round(target_amt - already_selected_sum, 2)
    if needed_amt <= 0:
        all_records = frappe.db.sql("""
            SELECT sc.name, sc.date, sc.amount, sc.card, sc.receipt_no, sc.shift
            FROM `tabStation Cards` sc
            WHERE sc.name IN %s
            ORDER BY sc.date ASC, sc.creation ASC
        """, (tuple(selected_card_names),), as_dict=True) if selected_card_names else []

        return {
            "success": True,
            "selected_names": selected_card_names,
            "selected_records": all_records,
            "total_selected": already_selected_sum,
            "variance": round(target_amt - already_selected_sum, 2),
            "is_exact": abs(target_amt - already_selected_sum) < 0.01,
            "message": f"Already selected cards (KES {already_selected_sum:,.2f}) meet or exceed target amount (KES {target_amt:,.2f})."
        }

    # Query unselected pending cards in chronological order (earliest date first)
    where_clauses = ["COALESCE(sc.is_reconciled, 0) = 0"]
    params = {}

    if selected_card_names:
        where_clauses.append("sc.name NOT IN %(sel)s")
        params["sel"] = tuple(selected_card_names)

    if from_date:
        where_clauses.append("sc.date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        where_clauses.append("sc.date <= %(to_date)s")
        params["to_date"] = to_date
    if card_type and card_type != "ALL":
        where_clauses.append("sc.card = %(card_type)s")
        params["card_type"] = card_type
    if station and station not in ("ALL", "All Stations", ""):
        where_clauses.append("s.station = %(station)s")
        params["station"] = station

    where_str = " AND ".join(where_clauses)
    unselected_cards = frappe.db.sql(f"""
        SELECT sc.name, sc.date, sc.amount, sc.card, sc.receipt_no, sc.shift
        FROM `tabStation Cards` sc
        LEFT JOIN `tabShift` s ON sc.shift = s.name
        WHERE {where_str}
        ORDER BY sc.date ASC, sc.creation ASC, sc.name ASC
    """, params, as_dict=True)

    if not unselected_cards:
        return {
            "success": True,
            "selected_names": selected_card_names,
            "selected_records": [],
            "total_selected": already_selected_sum,
            "variance": needed_amt,
            "is_exact": False,
            "message": f"No additional pending cards found in holding for this period."
        }

    target_cents = int(round(needed_amt * 100))
    chosen_cards = []

    # 1. Single card exact match
    for c in unselected_cards:
        if int(round(flt(c.amount) * 100)) == target_cents:
            chosen_cards = [c]
            break

    # 2. Pair exact match
    if not chosen_cards:
        pool = unselected_cards[:120]
        for i in range(len(pool)):
            rem_cents = target_cents - int(round(flt(pool[i].amount) * 100))
            if rem_cents < 0:
                continue
            for j in range(i + 1, len(pool)):
                if int(round(flt(pool[j].amount) * 100)) == rem_cents:
                    chosen_cards = [pool[i], pool[j]]
                    break
            if chosen_cards:
                break

    # 3. Dynamic programming subset sum on first 80 candidates (earliest dates prioritized)
    if not chosen_cards and len(unselected_cards) > 0:
        pool = [c for c in unselected_cards[:80] if int(round(flt(c.amount) * 100)) <= target_cents]
        dp = {0: []}
        for idx, c in enumerate(pool):
            val = int(round(flt(c.amount) * 100))
            new_dp = {}
            for s_val, path in dp.items():
                new_s = s_val + val
                if new_s <= target_cents and new_s not in dp and new_s not in new_dp:
                    new_dp[new_s] = path + [idx]
            dp.update(new_dp)
            if target_cents in dp:
                chosen_cards = [pool[k] for k in dp[target_cents]]
                break

    # 4. Greedy chronological fallback (earliest dates first)
    if not chosen_cards:
        curr_cents = 0
        for c in unselected_cards:
            val = int(round(flt(c.amount) * 100))
            if curr_cents + val <= target_cents:
                chosen_cards.append(c)
                curr_cents += val
            elif curr_cents == 0:
                chosen_cards.append(c)
                curr_cents += val
                break

    all_selected = list(selected_card_names) + [c["name"] for c in chosen_cards]
    chosen_sum = sum(flt(c["amount"]) for c in chosen_cards)
    total_selected = round(already_selected_sum + chosen_sum, 2)
    variance = round(target_amt - total_selected, 2)
    is_exact = abs(variance) < 0.01

    all_records = frappe.db.sql("""
        SELECT sc.name, sc.date, sc.amount, sc.card, sc.receipt_no, sc.shift
        FROM `tabStation Cards` sc
        WHERE sc.name IN %s
        ORDER BY sc.date ASC, sc.creation ASC
    """, (tuple(all_selected),), as_dict=True) if all_selected else []

    return {
        "success": True,
        "selected_names": all_selected,
        "selected_records": all_records,
        "newly_added_count": len(chosen_cards),
        "total_count": len(all_selected),
        "total_selected": total_selected,
        "target_amount": target_amt,
        "variance": variance,
        "is_exact": is_exact,
        "message": f"Auto-matched {len(all_selected)} cards totaling KES {total_selected:,.2f}" + (" (Exact match!)" if is_exact else f" (Variance: KES {variance:,.2f})")
    }


@frappe.whitelist()
def get_supplier_payment_form_data(supplier=None, station=None, account=None):
    """
    Returns data needed for the Transfer to Supplier & Invoices Reconcile modal:
    - active Bank Accounts with live balance (prioritized / filtered by station)
    - active Card Accounts with live balance
    - suppliers list (prioritized by station)
    - outstanding Purchase Invoices filtered by selected station and supplier
    """
    from frappe.utils import formatdate, flt
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # Infer station if not explicitly provided
    if not station or station in ("ALL", "All Stations", ""):
        if account:
            acc_u = account.upper()
            if "GALANA" in acc_u:
                station = "Galana Annex"
            elif "RUBIS" in acc_u or "SHIFT MAIN CASH" in acc_u:
                station = "RUBIS POA PLACE"
        elif supplier:
            sup_u = supplier.upper()
            if "GALANA" in sup_u:
                station = "Galana Annex"
            elif "RUBIS" in sup_u:
                station = "RUBIS POA PLACE"

    bank_accs = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 
          AND (account_type IN ('Bank', 'Cash') OR parent_account = 'Bank Accounts - KIL')
          AND company = %s
          AND docstatus < 2
        ORDER BY account_name ASC
    """, (company,), as_dict=True)

    bank_accounts = []
    card_accounts = []
    for acc in bank_accs:
        bal = frappe.db.sql("""
            SELECT SUM(debit - credit) FROM `tabGL Entry` 
            WHERE account = %s AND is_cancelled = 0
        """, (acc["name"],))[0][0] or 0.0
        acc["balance"] = round(flt(bal), 2)
        
        acc_upper = acc["name"].upper()
        # Tag account station
        if "GALANA" in acc_upper:
            acc["station"] = "Galana Annex"
        elif "RUBIS" in acc_upper or "SHIFT MAIN CASH" in acc_upper:
            acc["station"] = "RUBIS POA PLACE"
        else:
            acc["station"] = "" # Shared / General

        if "RUBIS A/C" in acc_upper or "GALANA A/C" in acc_upper or "CARD" in acc_upper:
            if not station or not acc["station"] or acc["station"].lower() == station.lower():
                card_accounts.append(acc)
        else:
            if not station or not acc["station"] or acc["station"].lower() == station.lower():
                bank_accounts.append(acc)

    # Sort so accounts specifically belonging to the active station appear on top
    if station:
        bank_accounts.sort(key=lambda a: (0 if a.get("station", "").lower() == station.lower() else 1, a["name"]))
        card_accounts.sort(key=lambda a: (0 if a.get("station", "").lower() == station.lower() else 1, a["name"]))

    suppliers = frappe.get_all("Supplier", fields=["name", "supplier_name"], order_by="supplier_name asc")
    
    # Determine default supplier based on station context
    default_supplier = ""
    if station:
        if "galana" in station.lower():
            galana_sup = next((s["name"] for s in suppliers if "galana" in s["name"].lower()), "")
            if galana_sup:
                default_supplier = galana_sup
        elif "rubis" in station.lower():
            rubis_sup = next((s["name"] for s in suppliers if "rubis" in s["name"].lower()), "")
            if rubis_sup:
                default_supplier = rubis_sup

    if not default_supplier:
        default_supplier = "RUBIS KENYA" if any(s["name"] == "RUBIS KENYA" for s in suppliers) else (suppliers[0]["name"] if suppliers else "")

    active_supplier = supplier or default_supplier

    invoices = []
    total_outstanding = 0.0

    where_clauses = ["pi.docstatus = 1", "pi.outstanding_amount > 0"]
    params = []

    if active_supplier:
        where_clauses.append("pi.supplier = %s")
        params.append(active_supplier)

    if station and station not in ("ALL", "All Stations", ""):
        if "galana" in station.lower():
            where_clauses.append("(LOCATE('Galana', pi.supplier) > 0 OR LOCATE('Galana', pii.warehouse) > 0)")
        elif "rubis" in station.lower():
            where_clauses.append("(LOCATE('RUBIS', pi.supplier) > 0 OR LOCATE('Rubis', pii.warehouse) > 0)")

    where_str = " AND ".join(where_clauses)
    inv_sql = f"""
        SELECT pi.name, pi.supplier, pi.posting_date, pi.due_date, pi.grand_total, pi.outstanding_amount, pi.bill_no,
               GROUP_CONCAT(DISTINCT pii.warehouse) as warehouses
        FROM `tabPurchase Invoice` pi
        LEFT JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE {where_str}
        GROUP BY pi.name
        ORDER BY pi.posting_date ASC, pi.name ASC
    """
    inv_rows = frappe.db.sql(inv_sql, tuple(params), as_dict=True)

    for r in inv_rows:
        r["grand_total"] = round(flt(r["grand_total"]), 2)
        r["outstanding_amount"] = round(flt(r["outstanding_amount"]), 2)
        r["posting_date_formatted"] = formatdate(r["posting_date"])
        r["due_date_formatted"] = formatdate(r["due_date"]) if r.get("due_date") else ""
        
        # Tag invoice station
        wh = str(r.get("warehouses") or "")
        sup = str(r.get("supplier") or "")
        if "galana" in wh.lower() or "galana" in sup.lower():
            r["station"] = "Galana Annex"
        elif "rubis" in wh.lower() or "rubis" in sup.lower():
            r["station"] = "RUBIS POA PLACE"
        else:
            r["station"] = "Consolidated"

        total_outstanding += r["outstanding_amount"]
    invoices = inv_rows

    return {
        "bank_accounts": bank_accounts,
        "card_accounts": card_accounts,
        "suppliers": suppliers,
        "station": station or "",
        "default_supplier": active_supplier,
        "invoices": invoices,
        "total_outstanding": round(total_outstanding, 2)
    }


@frappe.whitelist()
def get_account_transfer_form_data(source_account=None, station=None):
    """
    Returns available source and destination accounts for the Account Transfer / Payment modal:
    - Bank to Bank
    - Cash to Bank
    - Bank to Cash
    - Bank to Supplier (RUBIS A/C, GALANA A/C, Creditors, etc.)
    - Cash to Supplier
    - Bank/Cash to Expense
    """
    from frappe.utils import flt
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"

    # All active non-group accounts in company
    accounts = frappe.db.sql("""
        SELECT name, account_name, account_type, parent_account
        FROM `tabAccount`
        WHERE is_group = 0 AND company = %s AND docstatus < 2
        ORDER BY account_name ASC
    """, (company,), as_dict=True)

    # Live balance map for quick balance display
    bal_rows = frappe.db.sql("""
        SELECT account, SUM(debit - credit) as balance
        FROM `tabGL Entry`
        WHERE is_cancelled = 0
        GROUP BY account
    """, as_dict=True)
    bal_map = {b["account"]: round(flt(b["balance"]), 2) for b in bal_rows}

    source_accounts = []
    bank_accounts = []
    cash_accounts = []
    supplier_accounts = []
    expense_accounts = []

    for a in accounts:
        acc_name = a["name"]
        a_type = a["account_type"]
        a_upper = acc_name.upper()
        bal = bal_map.get(acc_name, 0.0)
        item = {
            "name": acc_name,
            "label": a["account_name"] or acc_name.replace(" - KIL", ""),
            "account_type": a_type,
            "balance": bal
        }

        # Source Accounts: Bank & Cash
        if a_type in ("Bank", "Cash") or "MAIN CASH" in a_upper or a["parent_account"] in ("Bank Accounts - KIL", "Cash In Hand - KIL"):
            source_accounts.append(item)

        # Categorize destination accounts
        if a_type == "Bank" or "BANK" in a_upper or a["parent_account"] == "Bank Accounts - KIL":
            bank_accounts.append(item)
        elif a_type == "Cash" or "CASH" in a_upper or a["parent_account"] == "Cash In Hand - KIL":
            cash_accounts.append(item)
        elif a_type == "Payable" or "RUBIS A/C" in a_upper or "GALANA A/C" in a_upper or "CREDITOR" in a_upper or "SUPPLIER" in a_upper:
            supplier_accounts.append(item)
        elif a_type in ("Expense", "Direct Expense", "Indirect Expense") or "EXPENSE" in a_upper:
            expense_accounts.append(item)

    selected_source = source_account or (source_accounts[0]["name"] if source_accounts else "")
    selected_source_bal = bal_map.get(selected_source, 0.0)

    return {
        "source_accounts": source_accounts,
        "grouped_targets": {
            "Bank Accounts": bank_accounts,
            "Cash Accounts": cash_accounts,
            "Supplier Accounts": supplier_accounts,
            "Expense Accounts": expense_accounts
        },
        "selected_source": selected_source,
        "selected_source_balance": selected_source_bal
    }


@frappe.whitelist()
def submit_account_transfer(paid_from_account, paid_to_account, amount, posting_date=None, reference=None, remarks=None):
    """
    Direct account-to-account transfer or payment:
    - Bank to Bank
    - Cash to Bank
    - Bank to Cash
    - Bank to Supplier (e.g. RUBIS A/C - KIL, Creditors - KIL)
    - Cash to Supplier
    - Bank/Cash to Expense
    Creates and submits an official Journal Entry.
    """
    from frappe.utils import flt, today, formatdate, now_datetime

    val_amount = flt(amount)
    if not val_amount or val_amount <= 0:
        frappe.throw("Please enter a valid transfer amount greater than 0.")
    if not paid_from_account:
        frappe.throw("Please select the Source Account (Paid From).")
    if not paid_to_account:
        frappe.throw("Please select the Target Account (Transfer To).")
    if paid_from_account == paid_to_account:
        frappe.throw("Source and Target accounts cannot be the same.")

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    posting_date = posting_date or today()
    ref_no = (reference or "").strip()
    memo = (remarks or "").strip()

    # ERPNext requires cheque_no if cheque_date is provided; fallback to auto-generated ref if blank
    effective_ref = ref_no or f"TRF-{frappe.utils.now_datetime().strftime('%y%m%d%H%M%S')}"

    full_remark = f"[ACCOUNT TRANSFER] Transfer KES {val_amount:,.2f} from {paid_from_account} to {paid_to_account}."
    if ref_no:
        full_remark += f" Ref: {ref_no}."
    if memo:
        full_remark += f" Notes: {memo}."

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = posting_date
    je.cheque_no = effective_ref
    je.cheque_date = posting_date
    je.user_remark = full_remark

    # Row 1: Debit Target Account
    target_row = {
        "account": paid_to_account,
        "debit_in_account_currency": val_amount,
        "credit_in_account_currency": 0.0,
        "user_remark": memo or f"Received from {paid_from_account}"
    }
    target_acc_type = frappe.db.get_value("Account", paid_to_account, "account_type")
    if target_acc_type == "Payable":
        target_row["party_type"] = "Supplier"
        if "RUBIS" in paid_to_account.upper():
            target_row["party"] = "RUBIS KENYA" if frappe.db.exists("Supplier", "RUBIS KENYA") else None
        elif "GALANA" in paid_to_account.upper():
            target_row["party"] = "GALANA OIL KENYA LTD" if frappe.db.exists("Supplier", "GALANA OIL KENYA LTD") else None
        if not target_row.get("party"):
            first_sup = frappe.get_all("Supplier", limit=1)
            if first_sup:
                target_row["party"] = first_sup[0].name
    je.append("accounts", target_row)

    # Row 2: Credit Source Account
    source_row = {
        "account": paid_from_account,
        "debit_in_account_currency": 0.0,
        "credit_in_account_currency": val_amount,
        "user_remark": memo or f"Transferred to {paid_to_account}"
    }
    source_acc_type = frappe.db.get_value("Account", paid_from_account, "account_type")
    if source_acc_type == "Receivable":
        source_row["party_type"] = "Customer"
    je.append("accounts", source_row)

    je.flags.ignore_permissions = True
    je.insert()
    je.submit()

    frappe.db.commit()

    return {
        "success": True,
        "journal_entry": je.name,
        "message": f"Transfer of KES {val_amount:,.2f} from {paid_from_account} to {paid_to_account} posted successfully ({je.name})!"
    }


@frappe.whitelist()
def submit_supplier_bank_transfer(paid_from_account, supplier, amount, posting_date=None, reference=None, invoice_names=None, remarks=None, payment_type_mode="bank_transfer"):
    """
    Creates and submits an official ERPNext Payment Entry from Bank Account or Card Holding Account to Supplier.
    Settles outstanding fuel Purchase Invoices (FIFO or specifically selected).
    """
    from frappe.utils import flt, today, formatdate, now_datetime
    import json

    if not amount or flt(amount) <= 0:
        frappe.throw("Please enter a valid amount greater than 0.")
    if not paid_from_account:
        frappe.throw("Please select the source account (Paid From).")
    if not supplier:
        frappe.throw("Please select the Supplier.")

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    posting_date = posting_date or today()
    val_amount = flt(amount)

    payable_account = frappe.db.get_value("Supplier", supplier, "default_payable_account") or "Creditors - KIL"

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.company = company
    pe.posting_date = posting_date
    pe.party_type = "Supplier"
    pe.party = supplier
    pe.paid_from = paid_from_account
    pe.paid_to = payable_account
    pe.paid_amount = val_amount
    pe.received_amount = val_amount
    pe.reference_no = reference or f"PAY-{frappe.utils.now_datetime().strftime('%y%m%d%H%M%S')}"
    pe.reference_date = posting_date
    prefix = "[SUPPLIER BANK TRANSFER]" if payment_type_mode == "bank_transfer" else "[CARD HOLDING RECONCILIATION]"
    pe.remarks = f"{prefix} Paid KES {val_amount:,.2f} to {supplier} from {paid_from_account}. {remarks or ''}".strip()

    # Parse selected invoices if provided
    parsed_invoices = []
    if invoice_names:
        if isinstance(invoice_names, str):
            try:
                parsed_invoices = json.loads(invoice_names)
            except Exception:
                parsed_invoices = [i.strip() for i in invoice_names.split(",") if i.strip()]
        elif isinstance(invoice_names, list):
            parsed_invoices = invoice_names

    inv_filter = {"supplier": supplier, "docstatus": 1, "outstanding_amount": [">", 0]}
    if parsed_invoices:
        inv_filter["name"] = ["in", parsed_invoices]

    outstanding_invoices = frappe.get_all(
        "Purchase Invoice",
        filters=inv_filter,
        fields=["name", "outstanding_amount", "grand_total", "posting_date"],
        order_by="posting_date asc, name asc"
    )

    remaining_to_allocate = val_amount
    allocated_invoices = []

    for inv in outstanding_invoices:
        if remaining_to_allocate <= 0:
            break
        alloc_amt = min(flt(inv["outstanding_amount"]), remaining_to_allocate)
        pe.append("references", {
            "reference_doctype": "Purchase Invoice",
            "reference_name": inv["name"],
            "total_amount": inv["grand_total"],
            "outstanding_amount": inv["outstanding_amount"],
            "allocated_amount": alloc_amt
        })
        remaining_to_allocate -= alloc_amt
        allocated_invoices.append(inv["name"])

    pe.flags.ignore_permissions = True
    pe.insert()
    pe.submit()

    # If this was a card holding offset, update tabStation Cards status
    cards_reconciled_count = 0
    if payment_type_mode == "card_offset":
        card_type = "RUBIS CARD" if "RUBIS" in paid_from_account.upper() else ""
        card_where = "COALESCE(is_reconciled, 0) = 0"
        card_params = {}
        if card_type:
            card_where += " AND card = %(ct)s"
            card_params["ct"] = card_type

        pending_cards = frappe.db.sql(f"""
            SELECT name, amount FROM `tabStation Cards`
            WHERE {card_where}
            ORDER BY date ASC, creation ASC
        """, card_params, as_dict=True)

        card_rem = val_amount
        cards_to_update = []
        for c in pending_cards:
            if card_rem <= 0:
                break
            cards_to_update.append(c["name"])
            card_rem -= flt(c["amount"])

        if cards_to_update:
            user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user
            by_name = f"{user_fullname} ({frappe.session.user})"
            memo_text = f" [Reconciled to {supplier} via Payment Entry {pe.name}]"
            frappe.db.sql("""
                UPDATE `tabStation Cards`
                SET is_reconciled = 1,
                    reconciled_by = %s,
                    reconciled_date = %s,
                    memo = CONCAT(IFNULL(memo, ''), %s)
                WHERE name IN %s
            """, (by_name, now_datetime(), memo_text, tuple(cards_to_update)))
            frappe.db.commit()
            cards_reconciled_count = len(cards_to_update)

    return {
        "success": True,
        "payment_entry": pe.name,
        "amount": val_amount,
        "supplier": supplier,
        "paid_from": paid_from_account,
        "allocated_invoices": allocated_invoices,
        "cards_reconciled_count": cards_reconciled_count,
        "message": f"Successfully created Payment Entry {pe.name} of KES {val_amount:,.2f} to {supplier}!"
    }


@frappe.whitelist()
def get_supplier_payments_register(supplier=None, from_date=None, to_date=None, search=None, page=1, page_length=50):
    """
    Returns history of supplier payments and card offset settlements.
    """
    from frappe.utils import formatdate, cint, flt
    page = cint(page) or 1
    page_length = cint(page_length) or 50
    offset = (page - 1) * page_length

    where_clauses = ["pe.docstatus = 1", "pe.party_type = 'Supplier'"]
    params = {}

    if supplier and supplier not in ("ALL", "All Suppliers", ""):
        where_clauses.append("pe.party = %(supplier)s")
        params["supplier"] = supplier

    if from_date:
        where_clauses.append("pe.posting_date >= %(from_date)s")
        params["from_date"] = from_date

    if to_date:
        where_clauses.append("pe.posting_date <= %(to_date)s")
        params["to_date"] = to_date

    if search:
        where_clauses.append("(pe.name LIKE %(s)s OR pe.party LIKE %(s)s OR pe.paid_from LIKE %(s)s OR pe.reference_no LIKE %(s)s OR pe.remarks LIKE %(s)s)")
        params["s"] = f"%{search.strip()}%"

    where_str = " AND ".join(where_clauses)

    total_count = frappe.db.sql(f"""
        SELECT COUNT(name) FROM `tabPayment Entry` pe
        WHERE {where_str}
    """, params)[0][0] or 0

    total_paid = frappe.db.sql(f"""
        SELECT SUM(paid_amount) FROM `tabPayment Entry` pe
        WHERE {where_str}
    """, params)[0][0] or 0.0

    rows = frappe.db.sql(f"""
        SELECT 
            pe.name, pe.posting_date, pe.party as supplier,
            pe.paid_from, pe.paid_amount, pe.reference_no,
            pe.remarks, pe.creation, pe.owner
        FROM `tabPayment Entry` pe
        WHERE {where_str}
        ORDER BY pe.posting_date DESC, pe.creation DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, {**params, "limit": page_length, "offset": offset}, as_dict=True)

    for r in rows:
        r["paid_amount"] = round(flt(r["paid_amount"]), 2)
        r["posting_date_formatted"] = formatdate(r["posting_date"])
        # Fetch references if any
        refs = frappe.get_all("Payment Entry Reference", filters={"parent": r["name"]}, fields=["reference_name", "allocated_amount"])
        r["references_summary"] = ", ".join([f"{ref['reference_name']} (KES {flt(ref['allocated_amount']):,.2f})" for ref in refs]) if refs else "On Account"

    return {
        "records": rows,
        "total_count": total_count,
        "total_paid": round(flt(total_paid), 2),
        "page": page,
        "page_length": page_length,
        "total_pages": (total_count + page_length - 1) // page_length if page_length else 1
    }


# ========================================================
# M-PESA RECONCILIATION & TILL AUDITING MODULE
# ========================================================

@frappe.whitelist()
def get_mpesa_reconciliation_data(from_date=None, to_date=None, station=None, till=None, status_filter=None):
    """
    Returns itemized shift M-Pesa records, transfer routings, and audit status.
    Performs carryover check, math discrepancy check, and unverified transfer audit.
    """
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = add_days(to_date, -30)

    conditions = ["s.docstatus < 2", "DATE(s.shift_date) >= %s", "DATE(s.shift_date) <= %s"]
    params = [from_date, to_date]

    if station and station not in ("ALL", "All Stations", ""):
        conditions.append("s.station = %s")
        params.append(station)

    if till and till not in ("ALL", "All Tills", ""):
        conditions.append("mp.mpesa_till = %s")
        params.append(till)

    where_clause = " AND ".join(conditions)

    # 1. Fetch shift mpesa readings
    shift_rows = frappe.db.sql(f"""
        SELECT 
            mp.name, mp.parent as shift_id, s.station, s.shift_date, s.status as shift_status,
            mp.mpesa_till, mp.csa, mp.opening_balance, mp.closing_balance, mp.transfers_made, mp.amount, mp.posted,
            mp.bank_name, mp.destination_account, mp.audit_status, mp.statement_ref, mp.audit_note,
            mp.verified_by, mp.verified_on
        FROM `tabShift M-Pesa Payment` mp
        JOIN `tabShift` s ON s.name = mp.parent
        WHERE {where_clause}
        ORDER BY mp.mpesa_till ASC, s.shift_date ASC, s.creation ASC
    """, params, as_dict=True)

    # Resolve CSA employee names
    csa_ids = list(set([r.csa for r in shift_rows if r.csa]))
    csa_name_map = {}
    if csa_ids:
        emp_data = frappe.get_all("Employee", filters={"name": ["in", csa_ids]}, fields=["name", "employee_name"])
        csa_name_map = {e.name: (e.employee_name or e.name) for e in emp_data}

    # 2. Perform Intelligent Carryover & Math Auditing
    audited_shifts = []
    till_chains = {}
    for r in shift_rows:
        till_chains.setdefault(r.mpesa_till, []).append(r)

    total_collections = 0.0
    total_transfers = 0.0
    total_discrepancies = 0
    total_verified = 0
    total_pending = 0

    for t_name, rows in till_chains.items():
        prev_closing = None
        for i, row in enumerate(rows):
            row["csa_name"] = csa_name_map.get(row.csa, row.csa or "Unassigned")
            opening = flt(row.opening_balance)
            closing = flt(row.closing_balance)
            transfers = flt(row.transfers_made)
            recorded_amount = flt(row.amount)

            total_collections += recorded_amount
            total_transfers += transfers

            expected_closing = opening + recorded_amount - transfers
            calc_collections = closing - opening + transfers

            flags = []

            # Check 1: Carryover continuity (Shift N opening vs Shift N-1 closing)
            carryover_mismatch = False
            if prev_closing is not None and abs(opening - prev_closing) > 0.01:
                carryover_mismatch = True
                diff = opening - prev_closing
                sign = "+" if diff > 0 else ""
                flags.append(f"Opening Mismatch: {sign}{diff:,.0f} KES (Prev: {prev_closing:,.0f}, Opened: {opening:,.0f})")

            # Check 2: Math Discrepancy
            math_discrepancy = False
            if abs(recorded_amount - calc_collections) > 0.01 and (closing > 0 or transfers > 0):
                math_discrepancy = True
                diff = recorded_amount - calc_collections
                flags.append(f"Arithmetic Discrepancy: {diff:,.0f} KES diff")

            # Check 3: Negative Collections
            if recorded_amount < 0 and row.shift_status in ("Closed", "Ended"):
                flags.append("Negative Collections Input")

            # Check 4: Unverified Transfer
            if transfers > 0 and (row.audit_status or "Pending") != "Verified":
                flags.append(f"Unverified Sweep: {transfers:,.0f} KES")

            is_discrepancy = len(flags) > 0
            if is_discrepancy:
                total_discrepancies += 1

            status = row.audit_status or ("Verified" if not is_discrepancy and row.shift_status == "Closed" and not transfers else "Pending")
            if status == "Verified":
                total_verified += 1
            elif status != "Flagged":
                total_pending += 1

            math_diff = (recorded_amount - calc_collections) if math_discrepancy else 0.0

            row["row_name"] = row.name
            row["shift"] = row.shift_id
            row["till_name"] = row.mpesa_till
            row["cashier_name"] = row.csa_name
            row["collections"] = recorded_amount
            row["transfers_out"] = transfers
            row["math_status"] = "Discrepancy" if math_discrepancy else "OK"
            row["math_discrepancy"] = math_diff
            row["carryover_status"] = "Mismatch" if carryover_mismatch else ("Match" if prev_closing is not None else "Initial")
            row["expected_opening"] = prev_closing if prev_closing is not None else opening
            row["is_flagged"] = is_discrepancy
            row["carryover_mismatch"] = carryover_mismatch
            row["audit_flags"] = flags
            row["is_discrepancy"] = is_discrepancy
            row["calculated_closing"] = expected_closing
            row["status_display"] = "Flagged" if is_discrepancy else (row.audit_status or "Pending")
            row["shift_date_formatted"] = formatdate(row.shift_date)

            audited_shifts.append(row)
            if closing > 0:
                prev_closing = closing
            elif opening > 0:
                prev_closing = opening

    # Sort audited shifts newest first for display
    audited_shifts.sort(key=lambda x: (str(x.shift_date), str(x.name)), reverse=True)

    # 3. Fetch Transfers & Sweeps Routing (from SCT and Shifts)
    sct_conditions = ["docstatus < 2", "date >= %s", "date <= %s"]
    sct_params = [from_date, to_date]
    if station and station not in ("ALL", "All Stations", ""):
        sct_conditions.append("(station = %s OR station IS NULL OR station = '')")
        sct_params.append(station)

    sct_where = " AND ".join(sct_conditions)
    sct_rows = frappe.db.sql(f"""
        SELECT 
            name, date, transaction_number, source_account, destination_account, amount, entered_by, station,
            audit_status, audit_note
        FROM `tabStation Cash Transfer`
        WHERE {sct_where} AND (
            source_account LIKE '%%MPESA%%' OR source_account LIKE '%%TILL%%' OR
            destination_account LIKE '%%MPESA%%' OR destination_account LIKE '%%TILL%%'
        )
        ORDER BY date DESC, creation DESC
    """, sct_params, as_dict=True)

    shift_transfers = []
    for r in shift_rows:
        if flt(r.transfers_made) > 0:
            dest = r.destination_account or r.bank_name or "Mapped Bank Account"
            shift_transfers.append({
                "type": "Shift Sweep",
                "transfer_type": "Shift Sweep",
                "transfer_id": r.name,
                "shift_id": r.shift_id,
                "shift": r.shift_id,
                "date": str(r.shift_date),
                "transfer_date": str(r.shift_date),
                "transfer_time": "",
                "date_formatted": formatdate(r.shift_date),
                "station": r.station,
                "source": r.mpesa_till,
                "source_account": r.mpesa_till,
                "destination": dest,
                "destination_account": dest,
                "ref": r.statement_ref or f"Shift {r.shift_id}",
                "slip_ref": r.statement_ref or f"Shift {r.shift_id}",
                "amount": flt(r.transfers_made),
                "entered_by": r.csa_name or "CSA",
                "audit_status": r.audit_status or "Pending",
                "audit_note": r.audit_note or ""
            })

    all_transfers = shift_transfers + [{
        "type": "Direct Transfer",
        "transfer_type": "Station Cash Transfer",
        "transfer_id": s.name,
        "shift_id": "-",
        "shift": "-",
        "date": str(s.date),
        "transfer_date": str(s.date),
        "transfer_time": "",
        "date_formatted": formatdate(s.date),
        "station": s.station or station or "Station",
        "source": s.source_account or "M-Pesa Till",
        "source_account": s.source_account or "M-Pesa Till",
        "destination": s.destination_account,
        "destination_account": s.destination_account,
        "ref": s.transaction_number,
        "slip_ref": s.transaction_number,
        "amount": flt(s.amount),
        "entered_by": s.entered_by or "Manager",
        "audit_status": s.audit_status or "Pending",
        "audit_note": s.audit_note or ""
    } for s in sct_rows]

    all_transfers.sort(key=lambda x: str(x["date"]), reverse=True)

    # 4. Live Tills Balance summary
    live_tills = frappe.db.sql("""
        SELECT name, till_name, till_number, station, default_account, bank_account
        FROM `tabM-Pesa Till`
        WHERE is_active = 1
        ORDER BY station ASC, till_name ASC
    """, as_dict=True)

    tills_balance_list = []
    total_live_balance = 0.0
    for t in live_tills:
        if station and station not in ("ALL", "All Stations", "") and t.station != station:
            continue
        latest = frappe.db.sql("""
            SELECT mp.closing_balance, mp.opening_balance, s.shift_date, s.status
            FROM `tabShift M-Pesa Payment` mp
            JOIN `tabShift` s ON s.name = mp.parent
            WHERE mp.mpesa_till = %s AND s.docstatus < 2
            ORDER BY s.shift_date DESC, s.creation DESC
            LIMIT 1
        """, (t.name,), as_dict=True)

        bal = 0.0
        ld = None
        if latest:
            l = latest[0]
            ld = l.shift_date
            bal = flt(l.closing_balance) if (l.status == "Closed" or flt(l.closing_balance) > 0) else flt(l.opening_balance)

        total_live_balance += bal
        tills_balance_list.append({
            "till": t.name,
            "till_name": t.till_name,
            "station": t.station,
            "balance": bal,
            "current_balance": bal,
            "last_date": str(ld) if ld else "",
            "account": t.default_account or "",
            "bank_account": t.bank_account or ""
        })

    # Apply status filter if provided
    if status_filter in ("discrepancies", "flagged"):
        audited_shifts = [r for r in audited_shifts if r.get("is_flagged")]
    elif status_filter in ("verified", "Verified"):
        audited_shifts = [r for r in audited_shifts if r.get("audit_status") == "Verified"]
    elif status_filter in ("pending", "Pending"):
        audited_shifts = [r for r in audited_shifts if r.get("audit_status") != "Verified"]

    return {
        "summary": {
            "live_balance": total_live_balance,
            "total_collections": total_collections,
            "total_transfers": total_transfers,
            "net_movement": total_collections - total_transfers,
            "flagged_count": total_discrepancies,
            "verified_count": total_verified,
            "pending_count": total_pending,
            "total_shifts_count": len(shift_rows),
            "total_transfers_count": len(all_transfers)
        },
        "kpis": {
            "live_balance": total_live_balance,
            "total_collections": total_collections,
            "total_transfers": total_transfers,
            "net_movement": total_collections - total_transfers,
            "discrepancies_count": total_discrepancies,
            "verified_count": total_verified,
            "pending_count": total_pending,
            "total_records": len(shift_rows)
        },
        "shifts": audited_shifts,
        "transfers": all_transfers,
        "tills_list": live_tills,
        "live_tills": tills_balance_list,
        "tills": tills_balance_list,
        "from_date": from_date,
        "to_date": to_date,
        "station": station or "All Stations"
    }


@frappe.whitelist()
def verify_mpesa_shift_reading(row_name, status="Verified", statement_ref=None, audit_note=None):
    """Marks a shift M-Pesa reading as Verified or Flagged with audit note."""
    if not row_name:
        frappe.throw("Reading ID is required.")

    update_dict = {
        "audit_status": status,
        "verified_by": frappe.session.user,
        "verified_on": frappe.utils.now_datetime()
    }
    if statement_ref is not None:
        update_dict["statement_ref"] = statement_ref
    if audit_note is not None:
        update_dict["audit_note"] = audit_note

    frappe.db.set_value("Shift M-Pesa Payment", row_name, update_dict)
    frappe.db.commit()
    return {"success": True, "status": "success", "message": f"M-Pesa reading marked as {status}."}


@frappe.whitelist()
def audit_mpesa_transfer_routing(transfer_id, transfer_type="Direct Transfer", status="Verified", audit_note=None, bank_slip_ref=None):
    """Audits and verifies an M-Pesa sweep / transfer."""
    if not transfer_id:
        frappe.throw("Transfer ID is required.")

    if transfer_type == "Shift Sweep" or frappe.db.exists("Shift M-Pesa Payment", transfer_id):
        frappe.db.set_value("Shift M-Pesa Payment", transfer_id, {
            "audit_status": status,
            "statement_ref": bank_slip_ref,
            "audit_note": audit_note,
            "verified_by": frappe.session.user,
            "verified_on": frappe.utils.now_datetime()
        })
    elif frappe.db.exists("Station Cash Transfer", transfer_id):
        frappe.db.set_value("Station Cash Transfer", transfer_id, {
            "audit_status": status,
            "audit_note": audit_note
        })
    frappe.db.commit()
    return {"success": True, "status": "success", "message": f"Transfer marked as {status}."}


@frappe.whitelist()
def submit_mpesa_statement_audit(station, till, statement_date, statement_opening, statement_inflows, statement_transfers, statement_closing, notes=None):
    """
    Performs side-by-side reconciliation between actual Safaricom Till statement figures and system records.
    """
    from frappe.utils import flt
    st_open = flt(statement_opening)
    st_in = flt(statement_inflows)
    st_out = flt(statement_transfers)
    st_close = flt(statement_closing)

    conditions = ["s.docstatus < 2", "DATE(s.shift_date) = %s"]
    params = [statement_date]
    if station and station not in ("ALL", "All Stations", ""):
        conditions.append("s.station = %s")
        params.append(station)
    if till and till not in ("ALL", "All Tills", ""):
        conditions.append("mp.mpesa_till = %s")
        params.append(till)

    where_clause = " AND ".join(conditions)
    records = frappe.db.sql(f"""
        SELECT 
            mp.name, mp.opening_balance, mp.closing_balance, mp.transfers_made, mp.amount
        FROM `tabShift M-Pesa Payment` mp
        JOIN `tabShift` s ON s.name = mp.parent
        WHERE {where_clause}
    """, params, as_dict=True)

    sys_in = sum(flt(r.amount) for r in records)
    sys_out = sum(flt(r.transfers_made) for r in records)
    sys_open = flt(records[0].opening_balance) if records else 0.0
    sys_close = flt(records[-1].closing_balance) if records else 0.0

    inflow_variance = st_in - sys_in
    transfer_variance = st_out - sys_out
    closing_variance = st_close - sys_close
    is_matched = abs(inflow_variance) < 1.0 and abs(transfer_variance) < 1.0 and abs(closing_variance) < 1.0

    if is_matched:
        for r in records:
            frappe.db.set_value("Shift M-Pesa Payment", r.name, {
                "audit_status": "Verified",
                "statement_ref": f"Stmt {statement_date}",
                "audit_note": notes or "Auto-matched with statement",
                "verified_by": frappe.session.user,
                "verified_on": frappe.utils.now_datetime()
            })
        frappe.db.commit()

    return {
        "statement_date": statement_date,
        "station": station,
        "till": till,
        "statement": {
            "opening": st_open,
            "inflows": st_in,
            "transfers": st_out,
            "closing": st_close
        },
        "system": {
            "opening": sys_open,
            "inflows": sys_in,
            "transfers": sys_out,
            "closing": sys_close
        },
        "variance": {
            "inflow_diff": inflow_variance,
            "transfer_diff": transfer_variance,
            "closing_diff": closing_variance
        },
        "is_matched": is_matched,
        "summary": "PERFECT MATCH! All collections & transfers verified against statement." if is_matched else f"DISCREPANCY DETECTED: Collections diff {inflow_variance:,.2f} KES, Transfers diff {transfer_variance:,.2f} KES."
    }


# ========================================================
# PURCHASES RECONCILIATION MODULE
# ========================================================

@frappe.whitelist()
def get_purchases_reconciliation_data(from_date=None, to_date=None, station=None, supplier=None, status=None, search=None):
    """
    Returns fuel/station purchases for executive audit, verification, and ledger posting to supplier accounts.
    """
    from frappe.utils import today, add_days, flt, formatdate

    if not to_date:
        to_date = today()
    if not from_date:
        from_date = add_days(to_date, -30)

    conditions = ["sp.docstatus < 2"]
    params = []

    if from_date and to_date:
        conditions.append("sp.receiving_date >= %s AND sp.receiving_date <= %s")
        params.extend([from_date, to_date])
    elif from_date:
        conditions.append("sp.receiving_date >= %s")
        params.append(from_date)
    elif to_date:
        conditions.append("sp.receiving_date <= %s")
        params.append(to_date)

    if station and station not in ("ALL", "All Stations", ""):
        conditions.append("s.station = %s")
        params.append(station)

    if supplier and supplier not in ("ALL", "All Suppliers", ""):
        conditions.append("sp.supplier = %s")
        params.append(supplier)

    if status and status not in ("ALL", "All", ""):
        if status.lower() in ("pending", "pending reconcile", "unreconciled"):
            conditions.append("(sp.reconciliation_status IS NULL OR sp.reconciliation_status = '' OR sp.reconciliation_status = 'Pending Reconcile')")
        elif status.lower() in ("reconciled", "verified"):
            conditions.append("sp.reconciliation_status = 'Reconciled'")

    if search and search.strip():
        s_term = f"%{search.strip()}%"
        conditions.append("""(
            sp.name LIKE %s 
            OR sp.document_invoice_number LIKE %s 
            OR sp.tax_invoice_number LIKE %s 
            OR sp.supplier LIKE %s 
            OR s.station LIKE %s 
            OR sp.shift LIKE %s
            OR sp.reconciled_voucher LIKE %s
        )""")
        params.extend([s_term] * 7)

    where_clause = " AND ".join(conditions)

    purchases_raw = frappe.db.sql(f"""
        SELECT 
            sp.name, sp.creation, sp.receiving_date, sp.document_date,
            sp.supplier, sp.shift, s.station,
            sp.tax_invoice_number, sp.document_invoice_number,
            sp.net_total, sp.total_vat, sp.grand_total,
            sp.transport_charge,
            IFNULL(sp.reconciliation_status, 'Pending Reconcile') as reconciliation_status,
            sp.reconciled_date, sp.reconciled_by, sp.reconciled_voucher,
            sp.reconciled_account, sp.reconciliation_note
        FROM `tabStation Purchase` sp
        LEFT JOIN `tabShift` s ON sp.shift = s.name
        WHERE {where_clause}
        ORDER BY sp.receiving_date DESC, sp.creation DESC
    """, tuple(params), as_dict=True)

    # Fetch child items for all retrieved purchases
    p_names = [p["name"] for p in purchases_raw]
    items_by_purchase = {}
    if p_names:
        placeholders = ", ".join(["%s"] * len(p_names))
        child_items = frappe.db.sql(f"""
            SELECT parent, item, target_location, target_tank, quantity, unit_cost, total_cost, vat_rate, net_total
            FROM `tabStation Purchase Item`
            WHERE parent IN ({placeholders})
            ORDER BY idx ASC
        """, tuple(p_names), as_dict=True)

        for ci in child_items:
            items_by_purchase.setdefault(ci["parent"], []).append(ci)

    # Available supplier accounts for matching
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    supplier_accounts = frappe.db.sql("""
        SELECT name, account_name, account_type
        FROM `tabAccount`
        WHERE is_group = 0 
          AND (LOCATE('GALANA', name) > 0 OR LOCATE('RUBIS', name) > 0 OR LOCATE('A/C', name) > 0 OR account_type = 'Payable')
          AND company = %s
          AND docstatus < 2
        ORDER BY name ASC
    """, (company,), as_dict=True)

    total_amount = 0.0
    reconciled_amount = 0.0
    pending_amount = 0.0
    reconciled_count = 0
    pending_count = 0

    purchases_list = []
    for p in purchases_raw:
        gt = flt(p.get("grand_total") or 0.0)
        status_val = p.get("reconciliation_status") or "Pending Reconcile"
        is_reconciled = (status_val == "Reconciled")

        total_amount += gt
        if is_reconciled:
            reconciled_amount += gt
            reconciled_count += 1
        else:
            pending_amount += gt
            pending_count += 1

        # Format items breakdown
        p_items = items_by_purchase.get(p["name"], [])
        item_summaries = []
        total_vol = 0.0
        for item in p_items:
            qty = flt(item.get("quantity"))
            total_vol += qty
            item_name = (item.get("item") or "").replace(" - KIL", "")
            unit_rate = flt(item.get("unit_cost"))
            item_summaries.append(f"{qty:,.0f} L {item_name} @ {unit_rate:,.2f}")

        # Target account default mapping
        target_account = p.get("reconciled_account")
        if not target_account:
            supp_upper = (p.get("supplier") or "").upper()
            if "RUBIS" in supp_upper:
                target_account = "RUBIS A/C - KIL"
            elif "GALANA" in supp_upper:
                target_account = "GALANA A/C - KIL"
            else:
                target_account = "RUBIS A/C - KIL" if frappe.db.exists("Account", "RUBIS A/C - KIL") else "GALANA A/C - KIL"

        p_dict = {
            "name": p["name"],
            "receiving_date": str(p["receiving_date"]) if p.get("receiving_date") else "",
            "receiving_date_formatted": formatdate(p["receiving_date"]) if p.get("receiving_date") else "",
            "document_date": str(p["document_date"]) if p.get("document_date") else "",
            "document_date_formatted": formatdate(p["document_date"]) if p.get("document_date") else "",
            "supplier": p.get("supplier") or "",
            "station": p.get("station") or "Unknown Station",
            "shift": p.get("shift") or "",
            "tax_invoice_number": p.get("tax_invoice_number") or "",
            "document_invoice_number": p.get("document_invoice_number") or "",
            "invoice_ref": p.get("document_invoice_number") or p.get("tax_invoice_number") or p["name"],
            "net_total": round(flt(p.get("net_total") or 0.0), 2),
            "total_vat": round(flt(p.get("total_vat") or 0.0), 2),
            "grand_total": round(gt, 2),
            "transport_charge": round(flt(p.get("transport_charge") or 0.0), 2),
            "reconciliation_status": status_val,
            "is_reconciled": is_reconciled,
            "reconciled_date": str(p.get("reconciled_date") or ""),
            "reconciled_date_formatted": formatdate(str(p.get("reconciled_date") or "")[:10]) if p.get("reconciled_date") else "",
            "reconciled_by": p.get("reconciled_by") or "",
            "reconciled_voucher": p.get("reconciled_voucher") or "",
            "reconciled_account": target_account,
            "reconciliation_note": p.get("reconciliation_note") or "",
            "items": p_items,
            "items_summary": " | ".join(item_summaries) if item_summaries else "Standard Fuel Delivery",
            "total_volume": round(total_vol, 2)
        }
        purchases_list.append(p_dict)

    # Master lists for UI dropdowns
    all_suppliers = frappe.db.sql("""
        SELECT DISTINCT supplier FROM `tabStation Purchase` WHERE supplier IS NOT NULL AND supplier != '' ORDER BY supplier ASC
    """, as_dict=True)

    all_stations = frappe.db.sql("""
        SELECT name as station FROM `tabFuel Station` ORDER BY name ASC
    """, as_dict=True)

    total_count = len(purchases_list)
    match_rate = round((reconciled_amount / total_amount * 100), 1) if total_amount > 0 else 0.0

    return {
        "purchases": purchases_list,
        "kpis": {
            "total_amount": round(total_amount, 2),
            "total_count": total_count,
            "reconciled_amount": round(reconciled_amount, 2),
            "reconciled_count": reconciled_count,
            "pending_amount": round(pending_amount, 2),
            "pending_count": pending_count,
            "match_rate": match_rate
        },
        "suppliers": [s["supplier"] for s in all_suppliers],
        "stations": [s["station"] for s in all_stations],
        "supplier_accounts": [sa["name"] for sa in supplier_accounts],
        "from_date": from_date,
        "to_date": to_date,
        "station": station or "All Stations",
        "supplier": supplier or "All Suppliers",
        "status": status or "Pending Reconcile"
    }


@frappe.whitelist()
def reconcile_station_purchases(purchase_names, supplier_account=None, posting_date=None, audit_note=None):
    """
    Reconciles selected Station Purchases and posts the whole amount directly to the respective Supplier Account.
    Journal Entry:
      Debit: Creditors - KIL (party: supplier) for whole amount [grand_total]
      Credit: supplier_account (e.g. RUBIS A/C - KIL / GALANA A/C - KIL) for whole amount [grand_total]
    """
    from frappe.utils import today, now_datetime, flt
    import json

    if isinstance(purchase_names, str):
        try:
            purchase_names = json.loads(purchase_names)
        except Exception:
            purchase_names = [n.strip() for n in purchase_names.split(",") if n.strip()]

    if not purchase_names:
        frappe.throw("No station purchases selected for reconciliation.")

    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "KILIBET INVESTMENT LTD"
    payable_account = frappe.get_cached_value('Company', company, 'default_payable_account') or "Creditors - KIL"

    reconciled_records = []
    total_posted = 0.0
    now_dt = now_datetime()
    user_fullname = frappe.get_cached_value("User", frappe.session.user, "full_name") or frappe.session.user

    for p_name in purchase_names:
        sp = frappe.get_doc("Station Purchase", p_name)
        if getattr(sp, "reconciliation_status", None) == "Reconciled" and sp.reconciled_voucher:
            continue

        gt = flt(sp.grand_total)
        if gt <= 0:
            frappe.throw(f"Purchase {p_name} has invalid grand total KES {gt}")

        # Determine target supplier account
        target_account = supplier_account
        if not target_account:
            supp_upper = (sp.supplier or "").upper()
            if "RUBIS" in supp_upper:
                target_account = "RUBIS A/C - KIL"
            elif "GALANA" in supp_upper:
                target_account = "GALANA A/C - KIL"
            else:
                target_account = "RUBIS A/C - KIL" if frappe.db.exists("Account", "RUBIS A/C - KIL") else "GALANA A/C - KIL"

        if not frappe.db.exists("Account", target_account):
            frappe.throw(f"Supplier account '{target_account}' does not exist.")

        # Determine station name for audit note
        station_name = frappe.db.get_value("Shift", sp.shift, "station") if sp.shift else "Station"
        inv_ref = sp.document_invoice_number or sp.tax_invoice_number or sp.name
        posting_dt = posting_date or sp.receiving_date or sp.document_date or today()

        # Create Journal Entry to post whole amount to Supplier Account
        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = company
        je.posting_date = posting_dt
        je.cheque_no = inv_ref
        je.cheque_date = sp.document_date or sp.receiving_date or today()
        je.user_remark = (
            f"[PURCHASE RECONCILIATION] Reconciled {sp.name} | Supplier: {sp.supplier} | "
            f"Station: {station_name} | Invoice: {inv_ref} | Whole Amount: KES {gt:,.2f} "
            f"posted to {target_account}. Reconciled by: {user_fullname}. {audit_note or ''}"
        ).strip()

        # Debit: Creditors - KIL (Supplier) for whole amount
        je.append("accounts", {
            "account": payable_account,
            "party_type": "Supplier",
            "party": sp.supplier,
            "debit_in_account_currency": gt,
            "user_remark": f"Purchase Reconciled: {sp.name} ({inv_ref})"
        })

        # Credit: Supplier Account (e.g. RUBIS A/C - KIL or GALANA A/C - KIL) for whole amount
        je.append("accounts", {
            "account": target_account,
            "credit_in_account_currency": gt,
            "user_remark": f"Fuel Delivery {sp.name} ({inv_ref})"
        })

        je.flags.ignore_permissions = True
        je.insert()
        je.submit()

        # Update Station Purchase record
        frappe.db.set_value("Station Purchase", sp.name, {
            "reconciliation_status": "Reconciled",
            "reconciled_date": now_dt,
            "reconciled_by": frappe.session.user,
            "reconciled_voucher": je.name,
            "reconciled_account": target_account,
            "reconciliation_note": audit_note or ""
        }, update_modified=False)

        total_posted += gt
        reconciled_records.append({
            "purchase": sp.name,
            "voucher": je.name,
            "amount": gt,
            "target_account": target_account
        })

    frappe.db.commit()

    return {
        "success": True,
        "reconciled_count": len(reconciled_records),
        "total_amount": round(total_posted, 2),
        "records": reconciled_records,
        "message": f"Successfully reconciled {len(reconciled_records)} purchase(s) totaling KES {total_posted:,.2f} to supplier account(s)."
    }


@frappe.whitelist()
def undo_purchase_reconciliation(purchase_name):
    """
    Reverts a reconciled purchase, cancelling the generated Journal Entry and resetting status to Pending Reconcile.
    """
    if not purchase_name:
        frappe.throw("Purchase Name is required.")

    sp = frappe.get_doc("Station Purchase", purchase_name)
    voucher_name = getattr(sp, "reconciled_voucher", None)

    if voucher_name and frappe.db.exists("Journal Entry", voucher_name):
        je = frappe.get_doc("Journal Entry", voucher_name)
        if je.docstatus == 1:
            je.flags.ignore_permissions = True
            je.cancel()

    frappe.db.set_value("Station Purchase", purchase_name, {
        "reconciliation_status": "Pending Reconcile",
        "reconciled_date": None,
        "reconciled_by": None,
        "reconciled_voucher": None,
        "reconciled_account": None,
        "reconciliation_note": None
    }, update_modified=False)

    frappe.db.commit()

    return {
        "success": True,
        "message": f"Reconciliation for purchase {purchase_name} reverted successfully."
    }


@frappe.whitelist()
def get_monthly_volumes_and_variances(station=None, from_date=None, to_date=None, group_by="day"):
    """
    Computes automated Monthly Fuel Volume Analysis, Daily/Weekly Variance Tracker,
    Tank Dip Stock Audit, and Pump/Nozzle Meter Throughput for the Executive Panel.
    Supports station context, custom date ranges, and grouping by day or week.
    """
    import calendar
    from datetime import datetime, date, timedelta
    from frappe.utils import flt, getdate, format_date

    today = date.today()
    if not to_date:
        to_date = str(today)
    if not from_date:
        f_dt = getdate(to_date).replace(day=1)
        from_date = str(f_dt)

    station_clause = ""
    station_params = []
    is_consolidated = not station or station in ("ALL", "All Stations", "")
    if not is_consolidated:
        station_clause = " AND s.station = %s"
        station_params.append(station)

    # 1. Retrieve all shifts in date range
    shifts = frappe.db.sql(f"""
        SELECT s.name, s.station, s.shift_date, s.shift_template, s.status, s.creation
        FROM `tabShift` s
        WHERE s.docstatus < 2 {station_clause}
          AND s.shift_date BETWEEN %s AND %s
        ORDER BY s.shift_date ASC, s.creation ASC
    """, tuple(station_params + [from_date, to_date]), as_dict=True)

    try:
        f_obj = getdate(from_date)
        t_obj = getdate(to_date)
        if f_obj.year == t_obj.year and f_obj.month == t_obj.month and f_obj.day == 1:
            month_label = f"{calendar.month_name[f_obj.month]} {f_obj.year}"
        else:
            month_label = f"{format_date(from_date)} to {format_date(to_date)}"
    except Exception:
        month_label = f"{from_date} to {to_date}"

    station_label = "All Stations (Consolidated)" if is_consolidated else station

    def calc_status(vp):
        av = abs(vp)
        if av <= 0.5:
            return {"label": "Normal (Within ±0.5%)", "status": "normal", "color": "#16a34a"}
        elif av <= 1.0:
            return {"label": "Watchlist (±0.5% - 1.0%)", "status": "warning", "color": "#f59e0b"}
        else:
            return {"label": "High Variance (> 1.0%)", "status": "danger", "color": "#dc2626"}

    if not shifts:
        empty_period = {
            "station": station_label,
            "from_date": str(from_date),
            "to_date": str(to_date),
            "month_label": month_label,
            "total_shifts": 0,
            "closed_shifts": 0,
            "open_shifts": 0,
            "first_shift": "—",
            "first_shift_name": "—",
            "first_shift_date": "—",
            "last_shift": "—",
            "last_shift_name": "—",
            "last_shift_date": "—"
        }
        empty_kpis = {
            "total_dispensed": 0.0,
            "total_net_meter_litres": 0.0,
            "total_tank_sales_litres": 0.0,
            "tank_depletion": 0.0,
            "total_purchases_litres": 0.0,
            "purchases_litres": 0.0,
            "purchases_count": 0,
            "total_variance_litres": 0.0,
            "station_variance": 0.0,
            "total_variance_percent": 0.0,
            "variance_pct": 0.0,
            "pms_dispensed": 0.0,
            "pms_net_litres": 0.0,
            "ago_dispensed": 0.0,
            "ago_net_litres": 0.0,
            "pms_variance_litres": 0.0,
            "ago_variance_litres": 0.0,
            "total_shifts": 0,
            "audit_status": "No Data",
            "audit_status_detail": {"label": "No Data", "status": "normal", "color": "#64748b"}
        }
        return {
            "station": station_label,
            "period": empty_period,
            "period_info": empty_period,
            "kpis": empty_kpis,
            "products": [],
            "daily": [],
            "daily_records": [],
            "weekly": [],
            "weekly_records": [],
            "shifts": [],
            "shift_records": [],
            "pumps_by_group": [],
            "pump_groups": [],
            "purchases": [],
            "purchases_ledger": []
        }

    shift_names = [s.name for s in shifts]
    first_shift = shifts[0]
    last_shift = shifts[-1]

    # 2. Fuel Tanks and Product Classification
    tank_filters = {}
    if not is_consolidated:
        tank_filters["station"] = station
    tanks = frappe.get_all("Fuel Tank", filters=tank_filters, fields=["name", "tank_name", "fuel_product", "station"])
    tank_prod_map = {t.name: (t.fuel_product or t.name) for t in tanks}

    def classify_fuel(text):
        s = (text or "").upper()
        if "PMS" in s or "PETROL" in s or "SUPER" in s or "GASOLINE" in s:
            return "PMS"
        if "AGO" in s or "DIESEL" in s:
            return "AGO"
        return "OTHER"

    # 3. Nozzles & Meter Readings
    nozzles = frappe.get_all("Pump Nozzle", fields=["name", "nozzle_name", "pump_group", "fuel_tank"])
    nozzle_tank_map = {n.name: n.fuel_tank for n in nozzles}

    all_readings = frappe.get_all(
        "Pump Meter Reading",
        filters={"parent": ["in", shift_names]},
        fields=["parent", "pump_nozzle", "sales_quantity_electronic", "sales_quantity_manual", "opening_electronic_meter", "closing_electronic_meter", "opening_manual_meter", "closing_manual_meter"]
    )

    # 4. Return to Tank (RTT)
    nozzle_rtt_map = {}
    nozzle_names_list = list(nozzle_tank_map.keys())
    if nozzle_names_list:
        st_rtts = frappe.db.sql("""
            SELECT DISTINCT name, pump_nozzle, volume_returned, shift, date
            FROM `tabStation Return To Tank`
            WHERE (shift IN %s OR (pump_nozzle IN %s AND date BETWEEN %s AND %s))
        """, (tuple(shift_names), tuple(nozzle_names_list), from_date, to_date), as_dict=True)

        for r in st_rtts:
            vol = flt(r.volume_returned)
            if r.pump_nozzle:
                nozzle_rtt_map[r.pump_nozzle] = nozzle_rtt_map.get(r.pump_nozzle, 0.0) + vol

        child_rtts = frappe.get_all(
            "Shift Return To Tank",
            filters={"parent": ["in", shift_names]},
            fields=["pump_nozzle", "quantity"]
        )
        for cr in child_rtts:
            if cr.pump_nozzle:
                nozzle_rtt_map[cr.pump_nozzle] = nozzle_rtt_map.get(cr.pump_nozzle, 0.0) + flt(cr.quantity)

    # 5. Purchases (Deliveries)
    purchases = frappe.get_all(
        "Station Purchase",
        filters={"shift": ["in", shift_names], "docstatus": ["<", 2]},
        fields=["name", "shift", "supplier", "receiving_date", "document_invoice_number", "grand_total"]
    )
    p_map = {p.name: p for p in purchases}
    p_items = frappe.get_all(
        "Station Purchase Item",
        filters={"parent": ["in", [p.name for p in purchases]]},
        fields=["parent", "item", "quantity", "unit_cost", "total_cost", "target_tank"]
    ) if purchases else []

    purchases_ledger = []
    pms_purchases = 0.0
    ago_purchases = 0.0
    tank_purchases_map = {}
    purchases_by_date = {}
    pms_purchases_by_date = {}
    ago_purchases_by_date = {}

    for item in p_items:
        p_doc = p_map.get(item.parent, {})
        it_name = item.item or ""
        ftype = classify_fuel(it_name)
        qty = flt(item.quantity)
        rec_date = str(p_doc.get("receiving_date") or "")

        ttank = item.target_tank
        if not ttank:
            for t in tanks:
                if classify_fuel(t.fuel_product or t.name) == ftype:
                    ttank = t.name
                    break

        if ftype == "PMS":
            pms_purchases += qty
            if rec_date:
                pms_purchases_by_date[rec_date] = pms_purchases_by_date.get(rec_date, 0.0) + qty
        elif ftype == "AGO":
            ago_purchases += qty
            if rec_date:
                ago_purchases_by_date[rec_date] = ago_purchases_by_date.get(rec_date, 0.0) + qty

        if ttank:
            tank_purchases_map[ttank] = tank_purchases_map.get(ttank, 0.0) + qty

        if rec_date:
            purchases_by_date[rec_date] = purchases_by_date.get(rec_date, 0.0) + qty

        purchases_ledger.append({
            "name": item.parent,
            "purchase_name": item.parent,
            "shift": p_doc.get("shift"),
            "supplier": p_doc.get("supplier"),
            "receiving_date": rec_date,
            "date": rec_date,
            "invoice_number": p_doc.get("document_invoice_number") or p_doc.get("name"),
            "item": it_name,
            "product": ftype,
            "product_type": ftype,
            "target_tank": ttank,
            "quantity": round(qty, 2),
            "unit_cost": round(flt(item.unit_cost), 2),
            "grand_total": round(flt(item.total_cost), 2),
            "total_cost": round(flt(item.total_cost), 2)
        })

    purchases_ledger.sort(key=lambda x: (x.get("date") or "", x.get("purchase_name") or ""))

    # 6. Map Shifts to Daily Buckets & Dispensed Volumes
    shift_date_map = {s.name: str(s.shift_date) for s in shifts}
    daily_buckets = {}
    for s in shifts:
        d_str = str(s.shift_date)
        if d_str not in daily_buckets:
            d_obj = getdate(s.shift_date)
            daily_buckets[d_str] = {
                "date": d_str,
                "day_name": d_obj.strftime("%A"),
                "formatted_date": format_date(d_str),
                "shifts": [],
                "pms_dispensed": 0.0,
                "ago_dispensed": 0.0,
                "total_dispensed": 0.0,
                "purchases": purchases_by_date.get(d_str, 0.0),
                "purchases_litres": purchases_by_date.get(d_str, 0.0),
                "pms_purchases": pms_purchases_by_date.get(d_str, 0.0),
                "ago_purchases": ago_purchases_by_date.get(d_str, 0.0),
                "opening_dip": 0.0,
                "closing_dip": 0.0,
                "tank_depletion": 0.0,
                "variance_litres": 0.0,
                "variance": 0.0,
                "variance_percent": 0.0,
                "variance_pct": 0.0,
                "status": calc_status(0.0),
                "audit_status": "Normal",
                # PMS Specific
                "pms_opening_dip": 0.0,
                "pms_closing_dip": 0.0,
                "pms_tank_depletion": 0.0,
                "pms_variance": 0.0,
                "pms_variance_litres": 0.0,
                "pms_variance_pct": 0.0,
                "pms_audit_status": "Normal",
                # AGO Specific
                "ago_opening_dip": 0.0,
                "ago_closing_dip": 0.0,
                "ago_tank_depletion": 0.0,
                "ago_variance": 0.0,
                "ago_variance_litres": 0.0,
                "ago_variance_pct": 0.0,
                "ago_audit_status": "Normal"
            }
        daily_buckets[d_str]["shifts"].append(s.name)

    nozzle_period_elec = {}
    nozzle_period_man = {}
    pms_total_gross = 0.0
    ago_total_gross = 0.0

    for r in all_readings:
        s_date = shift_date_map.get(r.parent)
        t_name = nozzle_tank_map.get(r.pump_nozzle, "")
        ftype = classify_fuel(r.pump_nozzle + " " + tank_prod_map.get(t_name, ""))
        qty = flt(r.sales_quantity_electronic)
        qty_man = flt(r.sales_quantity_manual)

        nozzle_period_elec[r.pump_nozzle] = nozzle_period_elec.get(r.pump_nozzle, 0.0) + qty
        nozzle_period_man[r.pump_nozzle] = nozzle_period_man.get(r.pump_nozzle, 0.0) + qty_man

        if ftype == "PMS":
            pms_total_gross += qty
            if s_date and s_date in daily_buckets:
                daily_buckets[s_date]["pms_dispensed"] += qty
        elif ftype == "AGO":
            ago_total_gross += qty
            if s_date and s_date in daily_buckets:
                daily_buckets[s_date]["ago_dispensed"] += qty

        if s_date and s_date in daily_buckets:
            daily_buckets[s_date]["total_dispensed"] += qty

    # 7. Tank Dips Opening & Closing per day (Total, PMS & AGO)
    shifts_by_date = {}
    for s in shifts:
        shifts_by_date.setdefault(str(s.shift_date), []).append(s)

    for d_str, s_list in sorted(shifts_by_date.items()):
        b = daily_buckets[d_str]
        first_s = frappe.get_doc("Shift", s_list[0].name)
        last_s = None
        for s_meta in reversed(s_list):
            s_doc = frappe.get_doc("Shift", s_meta.name)
            if any(flt(d.closing_dip) > 0 for d in (s_doc.dip_stick_readings or [])):
                last_s = s_doc
                break

        # Total Consolidated
        op_dips = sum(flt(d.opening_dip) for d in (first_s.dip_stick_readings or []))
        cl_dips = sum(flt(d.closing_dip) for d in (last_s.dip_stick_readings or [])) if last_s else op_dips
        pur = b["purchases"]
        b["opening_dip"] = round(op_dips, 1)
        b["closing_dip"] = round(cl_dips, 1)
        b["shifts_count"] = len(s_list)
        b["purchases_litres"] = pur

        if last_s:
            depletion = op_dips + pur - cl_dips
            b["tank_depletion"] = round(depletion, 1)
            var_l = b["total_dispensed"] - depletion
            b["variance_litres"] = round(var_l, 2)
            b["variance"] = round(var_l, 2)
            var_pct = (var_l / b["total_dispensed"] * 100) if b["total_dispensed"] > 0 else 0.0
            b["variance_percent"] = round(var_pct, 2)
            b["variance_pct"] = round(var_pct, 2)
            b["status"] = calc_status(var_pct)
            b["audit_status"] = "Normal" if abs(var_pct) <= 0.5 else ("Gain Alert" if var_pct > 0.5 else "Loss Alert")
        else:
            b["tank_depletion"] = 0.0
            b["variance"] = 0.0
            b["variance_litres"] = 0.0
            b["variance_pct"] = 0.0
            b["variance_percent"] = 0.0
            b["audit_status"] = "Normal"

        # Product-Specific Breakdown: PMS
        pms_op = sum(flt(d.opening_dip) for d in (first_s.dip_stick_readings or []) if classify_fuel(tank_prod_map.get(d.fuel_tank, d.fuel_tank)) == "PMS")
        pms_cl = sum(flt(d.closing_dip) for d in (last_s.dip_stick_readings or []) if classify_fuel(tank_prod_map.get(d.fuel_tank, d.fuel_tank)) == "PMS") if last_s else pms_op
        pms_pur = pms_purchases_by_date.get(d_str, 0.0)
        pms_sold = b["pms_dispensed"]
        b["pms_opening_dip"] = round(pms_op, 1)
        b["pms_closing_dip"] = round(pms_cl, 1)
        b["pms_purchases"] = round(pms_pur, 2)
        b["pms_purchases_litres"] = round(pms_pur, 2)
        if last_s and (pms_cl > 0 or pms_op > 0):
            pms_dep = pms_op + pms_pur - pms_cl
            b["pms_tank_depletion"] = round(pms_dep, 1)
            pms_var = pms_sold - pms_dep
            b["pms_variance"] = round(pms_var, 2)
            b["pms_variance_litres"] = round(pms_var, 2)
            pms_var_pct = (pms_var / pms_sold * 100) if pms_sold > 0 else 0.0
            b["pms_variance_pct"] = round(pms_var_pct, 2)
            b["pms_audit_status"] = "Normal" if abs(pms_var_pct) <= 0.5 else ("Gain Alert" if pms_var_pct > 0.5 else "Loss Alert")
        else:
            b["pms_tank_depletion"] = 0.0
            b["pms_variance"] = 0.0
            b["pms_variance_litres"] = 0.0
            b["pms_variance_pct"] = 0.0
            b["pms_audit_status"] = "Normal"

        # Product-Specific Breakdown: AGO
        ago_op = sum(flt(d.opening_dip) for d in (first_s.dip_stick_readings or []) if classify_fuel(tank_prod_map.get(d.fuel_tank, d.fuel_tank)) == "AGO")
        ago_cl = sum(flt(d.closing_dip) for d in (last_s.dip_stick_readings or []) if classify_fuel(tank_prod_map.get(d.fuel_tank, d.fuel_tank)) == "AGO") if last_s else ago_op
        ago_pur = ago_purchases_by_date.get(d_str, 0.0)
        ago_sold = b["ago_dispensed"]
        b["ago_opening_dip"] = round(ago_op, 1)
        b["ago_closing_dip"] = round(ago_cl, 1)
        b["ago_purchases"] = round(ago_pur, 2)
        b["ago_purchases_litres"] = round(ago_pur, 2)
        if last_s and (ago_cl > 0 or ago_op > 0):
            ago_dep = ago_op + ago_pur - ago_cl
            b["ago_tank_depletion"] = round(ago_dep, 1)
            ago_var = ago_sold - ago_dep
            b["ago_variance"] = round(ago_var, 2)
            b["ago_variance_litres"] = round(ago_var, 2)
            ago_var_pct = (ago_var / ago_sold * 100) if ago_sold > 0 else 0.0
            b["ago_variance_pct"] = round(ago_var_pct, 2)
            b["ago_audit_status"] = "Normal" if abs(ago_var_pct) <= 0.5 else ("Gain Alert" if ago_var_pct > 0.5 else "Loss Alert")
        else:
            b["ago_tank_depletion"] = 0.0
            b["ago_variance"] = 0.0
            b["ago_variance_litres"] = 0.0
            b["ago_variance_pct"] = 0.0
            b["ago_audit_status"] = "Normal"

    # 8. Product Level Summary (PMS & AGO)
    pms_rtt = sum(v for k, v in nozzle_rtt_map.items() if classify_fuel(k) == "PMS")
    ago_rtt = sum(v for k, v in nozzle_rtt_map.items() if classify_fuel(k) == "AGO")

    pms_net = pms_total_gross - pms_rtt
    ago_net = ago_total_gross - ago_rtt

    first_shift_doc = frappe.get_doc("Shift", first_shift.name)
    first_shift_dips = {d.fuel_tank: flt(d.opening_dip) for d in (first_shift_doc.dip_stick_readings or [])}

    last_closed_doc = None
    for s in reversed(shifts):
        s_doc = frappe.get_doc("Shift", s.name)
        if any(flt(d.closing_dip) > 0 for d in (s_doc.dip_stick_readings or [])):
            last_closed_doc = s_doc
            break
    if not last_closed_doc:
        last_closed_doc = first_shift_doc

    last_shift_dips = {d.fuel_tank: flt(d.closing_dip) for d in (last_closed_doc.dip_stick_readings or [])}

    # Only include purchases up to the last closed shift for exact dip reconciliation
    closed_shift_creations = last_closed_doc.creation
    pms_eval_purchases = sum(flt(it.quantity) for it in p_items if classify_fuel(it.item) == "PMS" and p_map.get(it.parent, {}).get("receiving_date") and getdate(p_map.get(it.parent, {}).get("receiving_date")) <= getdate(last_closed_doc.shift_date))
    ago_eval_purchases = sum(flt(it.quantity) for it in p_items if classify_fuel(it.item) == "AGO" and p_map.get(it.parent, {}).get("receiving_date") and getdate(p_map.get(it.parent, {}).get("receiving_date")) <= getdate(last_closed_doc.shift_date))

    pms_open = sum(first_shift_dips.get(t.name, 0.0) for t in tanks if classify_fuel(t.fuel_product or t.name) == "PMS")
    pms_close = sum(last_shift_dips.get(t.name, 0.0) for t in tanks if classify_fuel(t.fuel_product or t.name) == "PMS")
    pms_depletion = pms_open + pms_eval_purchases - pms_close
    pms_variance = pms_net - pms_depletion
    pms_var_pct = (pms_variance / pms_net * 100) if pms_net > 0 else 0.0

    ago_open = sum(first_shift_dips.get(t.name, 0.0) for t in tanks if classify_fuel(t.fuel_product or t.name) == "AGO")
    ago_close = sum(last_shift_dips.get(t.name, 0.0) for t in tanks if classify_fuel(t.fuel_product or t.name) == "AGO")
    ago_depletion = ago_open + ago_eval_purchases - ago_close
    ago_variance = ago_net - ago_depletion
    ago_var_pct = (ago_variance / ago_net * 100) if ago_net > 0 else 0.0

    products_summary = [
        {
            "product": "PMS",
            "product_type": "PMS",
            "product_label": "Petrol (PMS - Super)",
            "opening_dip": round(pms_open, 2),
            "purchases": round(pms_eval_purchases, 2),
            "closing_dip": round(pms_close, 2),
            "tank_depletion": round(pms_depletion, 2),
            "tank_sales": round(pms_depletion, 2),
            "gross_metre": round(pms_total_gross, 2),
            "gross_meter_litres": round(pms_total_gross, 2),
            "rtt": round(pms_rtt, 2),
            "rtt_litres": round(pms_rtt, 2),
            "net_metre": round(pms_net, 2),
            "net_meter_litres": round(pms_net, 2),
            "variance": round(pms_variance, 2),
            "variance_litres": round(pms_variance, 2),
            "variance_pct": round(pms_var_pct, 2),
            "variance_percent": round(pms_var_pct, 2),
            "audit_status": "Normal" if abs(pms_var_pct) <= 0.5 else ("Gain Alert" if pms_var_pct > 0.5 else "Loss Alert"),
            "status": calc_status(pms_var_pct)
        },
        {
            "product": "AGO",
            "product_type": "AGO",
            "product_label": "Diesel (AGO)",
            "opening_dip": round(ago_open, 2),
            "purchases": round(ago_eval_purchases, 2),
            "closing_dip": round(ago_close, 2),
            "tank_depletion": round(ago_depletion, 2),
            "tank_sales": round(ago_depletion, 2),
            "gross_metre": round(ago_total_gross, 2),
            "gross_meter_litres": round(ago_total_gross, 2),
            "rtt": round(ago_rtt, 2),
            "rtt_litres": round(ago_rtt, 2),
            "net_metre": round(ago_net, 2),
            "net_meter_litres": round(ago_net, 2),
            "variance": round(ago_variance, 2),
            "variance_litres": round(ago_variance, 2),
            "variance_pct": round(ago_var_pct, 2),
            "variance_percent": round(ago_var_pct, 2),
            "audit_status": "Normal" if abs(ago_var_pct) <= 0.5 else ("Gain Alert" if ago_var_pct > 0.5 else "Loss Alert"),
            "status": calc_status(ago_var_pct)
        }
    ]

    total_net_all = pms_net + ago_net
    total_tank_depletion = pms_depletion + ago_depletion
    total_purchases_all = pms_eval_purchases + ago_eval_purchases
    total_var_all = total_net_all - total_tank_depletion
    total_var_pct = (total_var_all / total_net_all * 100) if total_net_all > 0 else 0.0

    # 9. Weekly Aggregation (Total, PMS & AGO)
    weekly_buckets = {}
    for d_str, b in sorted(daily_buckets.items()):
        d_obj = getdate(d_str)
        y, w, _ = d_obj.isocalendar()
        wk_key = f"{y}-W{w:02d}"
        if wk_key not in weekly_buckets:
            start_of_week = d_obj - timedelta(days=d_obj.weekday())
            end_of_week = start_of_week + timedelta(days=6)
            weekly_buckets[wk_key] = {
                "week_key": wk_key,
                "week_label": f"Week {w} ({format_date(str(start_of_week))} - {format_date(str(end_of_week))})",
                "days_count": 0,
                "shifts_count": 0,
                # Total
                "pms_dispensed": 0.0,
                "ago_dispensed": 0.0,
                "total_dispensed": 0.0,
                "purchases": 0.0,
                "purchases_litres": 0.0,
                "tank_depletion": 0.0,
                "variance_litres": 0.0,
                "variance": 0.0,
                "variance_percent": 0.0,
                "variance_pct": 0.0,
                "status": calc_status(0.0),
                # PMS Specific
                "pms_purchases": 0.0,
                "pms_tank_depletion": 0.0,
                "pms_variance": 0.0,
                "pms_variance_pct": 0.0,
                # AGO Specific
                "ago_purchases": 0.0,
                "ago_tank_depletion": 0.0,
                "ago_variance": 0.0,
                "ago_variance_pct": 0.0
            }
        wk = weekly_buckets[wk_key]
        wk["days_count"] += 1
        wk["shifts_count"] += len(b["shifts"])
        wk["pms_dispensed"] += b["pms_dispensed"]
        wk["ago_dispensed"] += b["ago_dispensed"]
        wk["total_dispensed"] += b["total_dispensed"]
        wk["purchases"] += b["purchases"]
        wk["tank_depletion"] += b["tank_depletion"]
        wk["pms_purchases"] += b.get("pms_purchases", 0.0)
        wk["pms_tank_depletion"] += b.get("pms_tank_depletion", 0.0)
        wk["ago_purchases"] += b.get("ago_purchases", 0.0)
        wk["ago_tank_depletion"] += b.get("ago_tank_depletion", 0.0)

    weekly_records = []
    for wk_key, wk in sorted(weekly_buckets.items()):
        v_l = wk["total_dispensed"] - wk["tank_depletion"]
        v_pct = (v_l / wk["total_dispensed"] * 100) if wk["total_dispensed"] > 0 else 0.0
        wk["pms_dispensed"] = round(wk["pms_dispensed"], 2)
        wk["ago_dispensed"] = round(wk["ago_dispensed"], 2)
        wk["total_dispensed"] = round(wk["total_dispensed"], 2)
        wk["purchases"] = round(wk["purchases"], 2)
        wk["purchases_litres"] = round(wk["purchases"], 2)
        wk["tank_depletion"] = round(wk["tank_depletion"], 1)
        wk["variance_litres"] = round(v_l, 2)
        wk["variance"] = round(v_l, 2)
        wk["variance_percent"] = round(v_pct, 2)
        wk["variance_pct"] = round(v_pct, 2)
        wk["status"] = calc_status(v_pct)
        wk["audit_status"] = "Normal" if abs(v_pct) <= 0.5 else ("Gain Alert" if v_pct > 0.5 else "Loss Alert")

        # PMS weekly variance
        pms_v_l = wk["pms_dispensed"] - wk["pms_tank_depletion"]
        pms_v_pct = (pms_v_l / wk["pms_dispensed"] * 100) if wk["pms_dispensed"] > 0 else 0.0
        wk["pms_purchases"] = round(wk["pms_purchases"], 2)
        wk["pms_tank_depletion"] = round(wk["pms_tank_depletion"], 1)
        wk["pms_variance"] = round(pms_v_l, 2)
        wk["pms_variance_pct"] = round(pms_v_pct, 2)
        wk["pms_audit_status"] = "Normal" if abs(pms_v_pct) <= 0.5 else ("Gain Alert" if pms_v_pct > 0.5 else "Loss Alert")

        # AGO weekly variance
        ago_v_l = wk["ago_dispensed"] - wk["ago_tank_depletion"]
        ago_v_pct = (ago_v_l / wk["ago_dispensed"] * 100) if wk["ago_dispensed"] > 0 else 0.0
        wk["ago_purchases"] = round(wk["ago_purchases"], 2)
        wk["ago_tank_depletion"] = round(wk["ago_tank_depletion"], 1)
        wk["ago_variance"] = round(ago_v_l, 2)
        wk["ago_variance_pct"] = round(ago_v_pct, 2)
        wk["ago_audit_status"] = "Normal" if abs(ago_v_pct) <= 0.5 else ("Gain Alert" if ago_v_pct > 0.5 else "Loss Alert")

        weekly_records.append(wk)

    # 10. Shift Records
    shift_records = []
    for s in shifts:
        s_doc = frappe.get_doc("Shift", s.name)
        s_pmr = s_doc.pump_meter_readings or []
        s_pms = sum(flt(r.sales_quantity_electronic) for r in s_pmr if classify_fuel(r.pump_nozzle) == "PMS")
        s_ago = sum(flt(r.sales_quantity_electronic) for r in s_pmr if classify_fuel(r.pump_nozzle) == "AGO")
        s_tot = s_pms + s_ago

        s_op_dips = sum(flt(d.opening_dip) for d in (s_doc.dip_stick_readings or []))
        s_cl_dips = sum(flt(d.closing_dip) for d in (s_doc.dip_stick_readings or []))
        s_pur = sum(flt(it.quantity) for it in p_items if p_map.get(it.parent, {}).get("shift") == s.name)
        s_depl = s_op_dips + s_pur - s_cl_dips if s_cl_dips > 0 else 0.0
        s_var = s_tot - s_depl if s_cl_dips > 0 else 0.0

        shift_records.append({
            "shift_id": s.name,
            "shift_date": str(s.shift_date),
            "formatted_date": format_date(str(s.shift_date)),
            "template": s.shift_template or "Shift",
            "station": s.station,
            "status": s.status,
            "pms_dispensed": round(s_pms, 2),
            "ago_dispensed": round(s_ago, 2),
            "total_dispensed": round(s_tot, 2),
            "purchases": round(s_pur, 2),
            "purchases_litres": round(s_pur, 2),
            "closing_dip": round(s_cl_dips, 1),
            "shift_variance": round(s_var, 2),
            "variance_litres": round(s_var, 2)
        })

    # 11. Pump Islands & Nozzle Breakdown
    first_nozzle_readings = {r.pump_nozzle: r for r in (first_shift_doc.pump_meter_readings or [])}
    last_nozzle_readings = {r.pump_nozzle: r for r in (last_closed_doc.pump_meter_readings or [])}

    pump_groups_dict = {}
    station_nozzles = [n for n in nozzles if n.fuel_tank in tank_prod_map] if not is_consolidated else nozzles

    for n in station_nozzles:
        pg = n.pump_group or "Ungrouped"
        if pg not in pump_groups_dict:
            pump_groups_dict[pg] = {
                "group": pg,
                "group_name": pg,
                "nozzles": [],
                "total_net_litres": 0.0
            }

        fr = first_nozzle_readings.get(n.name)
        lr = last_nozzle_readings.get(n.name)

        op_elec = flt(fr.opening_electronic_meter) if fr else 0.0
        cl_elec = flt(lr.closing_electronic_meter) if lr and flt(lr.closing_electronic_meter) > 0 else op_elec
        diff_elec = nozzle_period_elec.get(n.name, 0.0)

        op_man = flt(fr.opening_manual_meter) if fr else 0.0
        cl_man = flt(lr.closing_manual_meter) if lr and flt(lr.closing_manual_meter) > 0 else op_man
        diff_man = nozzle_period_man.get(n.name, 0.0)

        noz_rtt = nozzle_rtt_map.get(n.name, 0.0)
        net_l = max(0.0, diff_elec - noz_rtt)

        p_name = tank_prod_map.get(n.fuel_tank, "")
        ftype = classify_fuel(n.name + " " + p_name)

        pump_groups_dict[pg]["nozzles"].append({
            "nozzle": n.nozzle_name or n.name,
            "nozzle_id": n.name,
            "nozzle_name": n.nozzle_name or n.name,
            "fuel_product": p_name or ("Petrol (PMS)" if ftype == "PMS" else "Diesel (AGO)"),
            "product": ftype,
            "product_type": ftype,
            "opening_meter_electronic": op_elec,
            "opening_electronic": op_elec,
            "closing_meter_electronic": cl_elec,
            "closing_electronic": cl_elec,
            "electronic_litres": round(diff_elec, 2),
            "electronic_volume": round(diff_elec, 2),
            "opening_meter_manual": op_man,
            "opening_manual": op_man,
            "closing_meter_manual": cl_man,
            "closing_manual": cl_man,
            "manual_litres": round(diff_man, 2),
            "manual_volume": round(diff_man, 2),
            "rtt": round(noz_rtt, 2),
            "rtt_litres": round(noz_rtt, 2),
            "net_litres": round(net_l, 2),
            "net_volume": round(net_l, 2),
            "share_pct": round((net_l / total_net_all * 100), 1) if total_net_all > 0 else 0.0,
            "share_percent": round((net_l / total_net_all * 100), 1) if total_net_all > 0 else 0.0
        })
        pump_groups_dict[pg]["total_net_litres"] += net_l

    sorted_groups = sorted(pump_groups_dict.values(), key=lambda g: g["group_name"])

    # 12. Final KPIs
    kpis = {
        "total_dispensed": round(total_net_all, 2),
        "total_net_meter_litres": round(total_net_all, 2),
        "total_tank_sales_litres": round(total_tank_depletion, 2),
        "tank_depletion": round(total_tank_depletion, 2),
        "total_purchases_litres": round(total_purchases_all, 2),
        "purchases_litres": round(total_purchases_all, 2),
        "purchases_count": len(purchases_ledger),
        "total_variance_litres": round(total_var_all, 2),
        "station_variance": round(total_var_all, 2),
        "total_variance_percent": round(total_var_pct, 2),
        "variance_pct": round(total_var_pct, 2),
        "total_shifts": len(shifts),
        "closed_shifts": len([s for s in shifts if s.status == "Closed"]),
        "open_shifts": len([s for s in shifts if s.status != "Closed"]),
        "pms_dispensed": round(pms_net, 2),
        "pms_net_litres": round(pms_net, 2),
        "pms_purchases": round(pms_eval_purchases, 2),
        "pms_tank_depletion": round(pms_depletion, 2),
        "pms_variance": round(pms_variance, 2),
        "pms_variance_litres": round(pms_variance, 2),
        "pms_variance_pct": round(pms_var_pct, 2),
        "ago_dispensed": round(ago_net, 2),
        "ago_net_litres": round(ago_net, 2),
        "ago_purchases": round(ago_eval_purchases, 2),
        "ago_tank_depletion": round(ago_depletion, 2),
        "ago_variance": round(ago_variance, 2),
        "ago_variance_litres": round(ago_variance, 2),
        "ago_variance_pct": round(ago_var_pct, 2),
        "audit_status": "Normal" if abs(total_var_pct) <= 0.5 else ("Gain Alert" if total_var_pct > 0.5 else "Loss Alert"),
        "audit_status_detail": calc_status(total_var_pct)
    }

    daily_list = []
    for k in sorted(daily_buckets.keys()):
        db = daily_buckets[k]
        db["pms_dispensed"] = round(db["pms_dispensed"], 2)
        db["ago_dispensed"] = round(db["ago_dispensed"], 2)
        db["total_dispensed"] = round(db["total_dispensed"], 2)
        daily_list.append(db)

    period_dict = {
        "station": station_label,
        "from_date": str(from_date),
        "to_date": str(to_date),
        "month_label": month_label,
        "total_shifts": len(shifts),
        "closed_shifts": len([s for s in shifts if s.status == "Closed"]),
        "open_shifts": len([s for s in shifts if s.status != "Closed"]),
        "first_shift_name": first_shift.name,
        "first_shift_date": str(first_shift.shift_date),
        "first_shift": first_shift.name,
        "last_shift_name": last_closed_doc.name if last_closed_doc else last_shift.name,
        "last_shift_date": str(last_closed_doc.shift_date if last_closed_doc else last_shift.shift_date),
        "last_shift": last_closed_doc.name if last_closed_doc else last_shift.name,
    }

    return {
        "station": station_label,
        "period": period_dict,
        "period_info": period_dict,
        "kpis": kpis,
        "products": products_summary,
        "daily": daily_list,
        "daily_records": daily_list,
        "weekly": weekly_records,
        "weekly_records": weekly_records,
        "shifts": shift_records,
        "shift_records": shift_records,
        "pumps_by_group": sorted_groups,
        "pump_groups": sorted_groups,
        "purchases": purchases_ledger,
        "purchases_ledger": purchases_ledger
    }






