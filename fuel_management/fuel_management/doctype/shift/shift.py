import frappe
from frappe.model.document import Document

class Shift(Document):
    def validate(self):
        self.auto_set_shift_display()
        self.validate_future_date()
        self.lock_shift_if_closed_for_csa()
        self.lock_active_shift_overlap()
        self.auto_fetch_opening_readings()
        self.calculate_sales_quantity()
        self.calculate_expected_stock()
        self.calculate_expected_cash()
        self.auto_inject_dry_stock_from_invoices()
        self.validate_csa_reconciliation()

    def calculate_sales_quantity(self):
        from frappe.utils import flt
        if self.pump_meter_readings:
            for row in self.pump_meter_readings:
                if row.closing_electronic_meter is not None and row.opening_electronic_meter is not None:
                    row.sales_quantity_electronic = max(0, flt(row.closing_electronic_meter) - flt(row.opening_electronic_meter))
                if row.closing_manual_meter is not None and row.opening_manual_meter is not None:
                    row.sales_quantity_manual = max(0, flt(row.closing_manual_meter) - flt(row.opening_manual_meter))

    def auto_inject_dry_stock_from_invoices(self):
        from frappe.utils import flt
        
        # Clean up orphaned injected inventory sales and injected fuel items
        if getattr(self, "inventory_sales", None):
            valid_invoice_entries = [inv.entry_number for inv in (self.invoices or []) if getattr(inv, "entry_number", None)]
            fuel_items = frappe.get_all("Item", filters={"item_group": ["in", ["FUEL", "FUELS"]]}, pluck="name")
            self.inventory_sales = [
                row for row in self.inventory_sales 
                if not row.get("is_invoice_sale") or 
                (row.get("reference_invoice") in valid_invoice_entries and row.item not in fuel_items)
            ]
            
        if not self.invoices:
            return
            
        for inv in self.invoices:
            if not inv.item: continue
            
            item_group = frappe.db.get_value("Item", inv.item, "item_group")
            if item_group and item_group.upper() in ["FUEL", "FUELS"]:
                continue
                
            found = False
            for row in (self.inventory_sales or []):
                if row.get("reference_invoice") == inv.entry_number:
                    row.item = inv.item
                    row.quantity = inv.quantity
                    row.selling_price = inv.rate
                    row.amount = inv.amount
                    row.sold_by = inv.csa
                    found = True
                    break
                    
            if not found:
                self.append("inventory_sales", {
                    "item": inv.item,
                    "quantity": inv.quantity,
                    "selling_price": inv.rate,
                    "amount": inv.amount,
                    "sold_by": getattr(inv, "inventory_csa", inv.csa) or inv.csa,
                    "is_invoice_sale": 1,
                    "reference_invoice": inv.entry_number
                })

    def auto_set_shift_display(self):
        from frappe.utils import getdate
        if self.shift_date and self.shift_template:
            day_name = getdate(self.shift_date).strftime('%A')
            self.shift_name_display = f"{day_name} {self.shift_template}"

    def validate_future_date(self):
        from frappe.utils import getdate, today
        if getdate(self.shift_date) > getdate(today()):
            frappe.throw("Shift Date cannot be in the future.")

    def lock_active_shift_overlap(self):
        if self.is_new():
            active_shift = frappe.db.get_value("Shift", {"station": self.station, "status": "Open", "name": ("!=", self.name)}, "name")
            if active_shift:
                frappe.throw(f"Cannot start a new shift. Shift {active_shift} is currently active for this station.")

    def calculate_expected_cash(self):
        from frappe.utils import flt
        total_fuel_amount = 0.0
        
        if self.pump_meter_readings:
            for row in self.pump_meter_readings:
                if row.sales_quantity_electronic and row.sales_quantity_electronic > 0 and row.pump_nozzle:
                    tank = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                    if tank:
                        item_code = frappe.db.get_value("Fuel Tank", tank, "fuel_product")
                        if item_code:
                            # Pricing Engine: Fetch historical price where Valid From <= Shift Date
                            price_record = frappe.get_all("Item Price", 
                                filters={"item_code": item_code, "price_list": "Standard Selling", "valid_from": ("<=", self.shift_date)},
                                fields=["price_list_rate"],
                                order_by="valid_from desc",
                                limit=1
                            )
                            price = price_record[0].price_list_rate if price_record else 0.0
                            total_fuel_amount += (row.sales_quantity_electronic * price)

        total_dry_stock_amount = sum(flt(row.amount) for row in (self.inventory_sales or []))
        self.expected_dry_stock_cash = total_dry_stock_amount
        
        total_mpesa = 0.0
        if self.mpesa_payments:
            for row in self.mpesa_payments:
                row.amount = flt(row.closing_balance) - flt(row.opening_balance) + flt(row.transfers_made)
                if row.amount < 0:
                    frappe.throw(f"Amount collected for {row.mpesa_till} cannot be negative. Please check the closing balance and transfers made.")
                total_mpesa += row.amount

        total_cards = sum(flt(row.amount) for row in (self.card_payments or []))
        total_invoices = sum(flt(row.amount) for row in (self.invoices or []))
        total_expenses = sum(flt(row.amount) for row in (self.shift_expenses or []))
        total_procurement = sum(flt(row.amount) for row in (self.procurement or []))

        # Deduct Fleet Card CSA Drops
        total_fleet_drops = 0.0
        
        # Deduct Station Return To Tank (RTT)
        total_rtt_amount = 0.0
        if not self.is_new():
            rtt_records = frappe.get_all("Station Return To Tank", filters={"shift": self.name}, fields=["amount"])
            total_rtt_amount = sum(frappe.utils.flt(r.amount) for r in rtt_records)

        if not self.is_new():
            fleet_summaries = frappe.get_all("Fleet Card Shift Summary", filters={"shift": self.name, "docstatus": ("<", 2)}, fields=["total_csa_drops"])
            for s in fleet_summaries:
                total_fleet_drops += flt(s.total_csa_drops)

        self.expected_cash = total_fuel_amount - (total_mpesa + total_cards + total_invoices + total_expenses + total_procurement + total_fleet_drops + total_rtt_amount)

        if getattr(self, "actual_cash", None) is not None:
            self.cash_variance = flt(self.actual_cash) - flt(self.expected_cash)
            
        if getattr(self, "actual_dry_stock_cash", None) is not None:
            self.dry_stock_cash_variance = flt(self.actual_dry_stock_cash) - flt(self.expected_dry_stock_cash)

    def on_update(self):
        self.create_stock_entry_on_close()
        self.post_cash_variance_to_liability_ledger()
        self.create_revenue_accounting_on_close()
        self.create_topup_accounting_on_close()

    def create_revenue_accounting_on_close(self):
        from frappe.utils import nowdate, flt
        
        if self.status != "Closed":
            return
            
        station_doc = frappe.get_doc("Fuel Station", self.station)
        
        # Ensure all configuration fields are present
        required_accounts = {
            "shift_control_account": "Shift Control Account",
            "cash_account": "Main Cash Account",
            "fuel_sales_account": "Fuel Sales Account",
            "dry_stock_sales_account": "Dry Stock Sales Account",
            "greasing_sales_account": "Greasing Sales Account",
            "shortfall_account": "Shortfall Account",
            "overage_account": "Overage Account"
        }
        
        for fieldname, label in required_accounts.items():
            if not getattr(station_doc, fieldname):
                frappe.throw(f"Accounting Configuration Error: Please set the '{label}' in Fuel Station {self.station}.")
                
        company = frappe.defaults.get_user_default("Company")
        if not company:
            frappe.throw("No default Company found.")
            
        # 1. Get nozzle prices to calculate fuel revenue
        from fuel_management.fuel_management.api import get_nozzle_prices
        prices = get_nozzle_prices(self.station, self.shift_date)
        
        total_fuel_revenue = 0.0
        for row in (self.pump_meter_readings or []):
            if getattr(row, "sales_quantity_electronic", 0) > 0:
                price = prices.get(row.pump_nozzle, {}).get("price", 0.0)
                total_fuel_revenue += flt(row.sales_quantity_electronic) * flt(price)
                
        # 2. Calculate Dry Stock Revenue
        total_dry_stock_revenue = 0.0
        for row in (self.inventory_sales or []):
            qty = row.total_volume if getattr(row, "total_volume", 0) else row.quantity
            rate = row.rate if getattr(row, "rate", 0) else 0.0
            amt = getattr(row, "amount", 0)
            if amt:
                total_dry_stock_revenue += flt(amt)
            else:
                total_dry_stock_revenue += flt(qty) * flt(rate)
                
        # 3. Calculate Greasing Revenue
        total_greasing = flt(getattr(self, "total_greasing_sales", 0))
            
        total_revenue = total_fuel_revenue + total_dry_stock_revenue + total_greasing
        
        # We will create ONE massive Journal Entry for the entire shift closure.
        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.posting_date = self.shift_date or nowdate()
        je.company = company
        je.user_remark = f"Shift Closure Accounting for Shift {self.name}"
        
        # --- REVENUE RECOGNITION (Income Generation) ---
        if total_revenue > 0:
            je.append("accounts", {
                "account": station_doc.shift_control_account,
                "debit_in_account_currency": total_revenue,
                "user_remark": f"Total Shift Revenue Expected (Gross)"
            })
            if total_fuel_revenue > 0:
                je.append("accounts", {
                    "account": station_doc.fuel_sales_account,
                    "credit_in_account_currency": total_fuel_revenue,
                    "user_remark": f"Total Fuel Sales"
                })
            if total_dry_stock_revenue > 0:
                je.append("accounts", {
                    "account": station_doc.dry_stock_sales_account,
                    "credit_in_account_currency": total_dry_stock_revenue,
                    "user_remark": f"Total Dry Stock Sales"
                })
            if total_greasing > 0:
                je.append("accounts", {
                    "account": station_doc.greasing_sales_account,
                    "credit_in_account_currency": total_greasing,
                    "user_remark": f"Total Greasing Sales"
                })
                
        # --- PAYMENT ALLOCATIONS (Clearing the Control Account) ---
        
        # A. CSA Cash (Includes Cash from Sales AND Cash from Customer Payments)
        recons = frappe.get_all("Shift Cash Reconciliation", filters={"shift": self.name}, fields=["csa", "actual_cash", "variance", "actual_dry_stock_cash"])
        for r in recons:
            tot_cash = flt(r.actual_cash) + flt(r.actual_dry_stock_cash)
            if tot_cash > 0:
                csa_name = frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa
                
                # Debit Main Cash
                je.append("accounts", {
                    "account": station_doc.cash_account,
                    "debit_in_account_currency": tot_cash,
                    "user_remark": f"Cash Submitted by {csa_name}"
                })
                
                cust_payments = frappe.db.sql("""
                    SELECT customer, amount FROM 	abCustomer Payment 
                    WHERE shift=%s AND csa=%s AND docstatus=1
                """, (self.name, r.csa), as_dict=True)
                
                if not cust_payments:
                    cust_payments = frappe.db.sql("""
                        SELECT customer, amount FROM 	abCustomer Payment 
                        WHERE shift=%s AND csa=%s
                    """, (self.name, r.csa), as_dict=True)
                    
                total_cp = sum([flt(cp.amount) for cp in (cust_payments or [])])
                cash_for_sales = tot_cash - total_cp
                
                # Credit Shift Control (for the Sales portion)
                if cash_for_sales > 0:
                    je.append("accounts", {
                        "account": station_doc.shift_control_account,
                        "credit_in_account_currency": cash_for_sales,
                        "user_remark": f"Clear Cash Sales from {csa_name}"
                    })
                elif cash_for_sales < 0:
                    je.append("accounts", {
                        "account": station_doc.shift_control_account,
                        "debit_in_account_currency": abs(cash_for_sales),
                        "user_remark": f"Adjustment for Sales from {csa_name}"
                    })
                
                # Credit Customer AR (for the Customer Payment portion)
                for cp in (cust_payments or []):
                    if flt(cp.amount) > 0:
                        cust_doc = frappe.get_doc("Customer", cp.customer)
                        ar_acct = cust_doc.default_account or frappe.db.get_value("Company", company, "default_receivable_account")
                        je.append("accounts", {
                            "account": ar_acct,
                            "party_type": "Customer",
                            "party": cp.customer,
                            "credit_in_account_currency": cp.amount,
                            "user_remark": f"Customer Payment collected by {csa_name}"
                        })
                
            # Variances
            var = flt(r.variance)
            if var < 0:
                shortfall = abs(var)
                csa_name = frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa
                je.append("accounts", {
                    "account": station_doc.shortfall_account,
                    "party_type": "Employee",
                    "party": r.csa,
                    "debit_in_account_currency": shortfall,
                    "user_remark": f"Shortfall for {csa_name}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": shortfall,
                    "user_remark": f"Clear Shortfall for {csa_name}"
                })
            elif var > 0:
                # Overage
                csa_name = frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa
                je.append("accounts", {
                    "account": station_doc.cash_account,
                    "debit_in_account_currency": var,
                    "user_remark": f"Overage Cash Submitted by {csa_name}"
                })
                je.append("accounts", {
                    "account": station_doc.overage_account,
                    "credit_in_account_currency": var,
                    "user_remark": f"Overage Income for {csa_name}"
                })

        # B. Invoices
        for inv in (self.invoices or []):
            if flt(inv.amount) > 0:
                customer_doc = frappe.get_doc("Customer", inv.customer)
                ar_account = customer_doc.default_account or frappe.db.get_value("Company", company, "default_receivable_account")
                if not ar_account:
                    frappe.throw(f"No AR account found for customer {inv.customer}")
                je.append("accounts", {
                    "account": ar_account,
                    "party_type": "Customer",
                    "party": inv.customer,
                    "debit_in_account_currency": inv.amount,
                    "user_remark": f"Credit Sale (Invoice)",
                    "reference_type": "Shift",
                    "reference_name": self.name
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": inv.amount,
                    "user_remark": f"Clear Invoice for {inv.customer}"
                })
                
        # C. M-Pesa
        for m in (self.mpesa_payments or []):
            if flt(m.amount) > 0:
                mop_account = frappe.db.get_value("Mode of Payment Account", {"parent": m.mpesa_till, "company": company}, "default_account")
                if not mop_account:
                    frappe.throw(f"No Default Account mapped for Mode of Payment: {m.mpesa_till}")
                je.append("accounts", {
                    "account": mop_account,
                    "debit_in_account_currency": m.amount,
                    "user_remark": f"M-Pesa Payment ({m.mpesa_till})"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": m.amount,
                    "user_remark": f"Clear M-Pesa"
                })
                
        # D. Cards
        for c in (self.card_payments or []):
            if flt(c.amount) > 0:
                mop = getattr(c, "mode_of_payment", "Card")
                mop_account = frappe.db.get_value("Mode of Payment Account", {"parent": mop, "company": company}, "default_account")
                if not mop_account:
                    mop_account = frappe.db.get_value("Mode of Payment Account", {"parent": "Card", "company": company}, "default_account")
                    if not mop_account:
                        frappe.throw(f"No Default Account mapped for Mode of Payment: Card")
                je.append("accounts", {
                    "account": mop_account,
                    "debit_in_account_currency": c.amount,
                    "user_remark": f"Card Payment"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": c.amount,
                    "user_remark": f"Clear Card"
                })
                
        # E. Expenses
        for e in (self.shift_expenses or []):
            if flt(e.amount) > 0:
                je.append("accounts", {
                    "account": e.expense_account,
                    "debit_in_account_currency": e.amount,
                    "user_remark": f"Shift Expense: {e.description}"
                })
                je.append("accounts", {
                    "account": station_doc.shift_control_account,
                    "credit_in_account_currency": e.amount,
                    "user_remark": f"Clear Expense"
                })
                
        # F. Return to Tank (RTT)
        for rtt in frappe.get_all("Station Return To Tank", filters={"shift": self.name}, fields=["item", "volume_returned"]):
            if flt(rtt.volume_returned) > 0:
                price_rec = frappe.get_all("Item Price", filters={"item_code": rtt.item, "price_list": "Standard Selling", "valid_from": ("<=", self.shift_date)}, fields=["price_list_rate"], order_by="valid_from desc", limit=1)
                price = flt(price_rec[0].price_list_rate) if price_rec else 0.0
                rtt_val = flt(rtt.volume_returned) * flt(price)
                if rtt_val > 0:
                    je.append("accounts", {
                        "account": station_doc.fuel_sales_account,
                        "debit_in_account_currency": rtt_val,
                        "user_remark": f"Reverse RTT Volume: {rtt.volume_returned}"
                    })
                    je.append("accounts", {
                        "account": station_doc.shift_control_account,
                        "credit_in_account_currency": rtt_val,
                        "user_remark": f"Clear RTT"
                    })
                
        if len(je.accounts) > 0:
            je.flags.ignore_permissions = True
            je.insert()
            je.submit()
            frappe.msgprint(f"Generated Shift Control Journal Entry {je.name}")

    def post_cash_variance_to_liability_ledger(self):
        if self.status != "Closed": return
        
        reconciliations = frappe.get_all(
            "Shift Cash Reconciliation", 
            filters={"shift": self.name}, 
            fields=["csa", "variance"]
        )
        
        for recon in reconciliations:
            if recon.variance < 0:
                shortfall = abs(recon.variance)
                existing = frappe.db.exists("Staff Liability Ledger", {"shift": self.name, "employee": recon.csa, "reason": ("like", "Shift Cash Variance Shortfall%")})
                if not existing:
                    ledger = frappe.new_doc("Staff Liability Ledger")
                    ledger.employee = recon.csa
                    ledger.date = self.shift_date
                    ledger.shift = self.name
                    ledger.amount = shortfall
                    ledger.reason = f"Shift Cash Variance Shortfall for Shift {self.name}"
                    ledger.insert(ignore_permissions=True)
                    ledger.submit()
                    frappe.msgprint(f"Staff Liability Ledger created for CSA {recon.csa} for shortfall of {shortfall}")

    def validate_csa_reconciliation(self):
        if self.status in ["Ended", "Closed"]:
            if self.assigned_csas:
                csas_in_shift = [row.csa for row in self.assigned_csas if row.csa]
                if not csas_in_shift:
                    return
                reconciled = frappe.get_all("Shift Cash Reconciliation", filters={"shift": self.name}, pluck="csa")
                missing = [csa for csa in csas_in_shift if csa not in reconciled]
                if missing:
                    frappe.throw(f"Cannot close shift. The following CSAs have not been reconciled: {', '.join(missing)}")

    def lock_shift_if_closed_for_csa(self):
        if not self.is_new():
            old_status = frappe.db.get_value("Shift", self.name, "status")
            if old_status == "Closed":
                if "System Manager" not in frappe.get_roles(frappe.session.user):
                    frappe.throw("Closed Shifts cannot be modified. Please contact an Administrator.")

    def auto_fetch_opening_readings(self):
        last_shift_doc = None
        station_opening = None
        if self.station:
            last_shift = frappe.get_all("Shift", filters={"station": self.station, "status": "Closed", "name": ("!=", self.name)}, order_by="end_time desc", limit=1)
            if last_shift:
                last_shift_doc = frappe.get_doc("Shift", last_shift[0].name)
                
            sob = frappe.get_all("Station Opening Balance", filters={"station": self.station, "docstatus": 1}, order_by="date desc, creation desc", limit=1)
            if sob:
                station_opening = frappe.get_doc("Station Opening Balance", sob[0].name)

        if not self.pump_meter_readings and self.station:
            pump_groups = frappe.get_all("Pump Group", filters={"station": self.station}, pluck="name")
            nozzles = frappe.get_all("Pump Nozzle", filters={"pump_group": ["in", pump_groups]}, fields=["name"]) if pump_groups else []
            
            for nozzle in nozzles:
                opening_elec = 0
                opening_manual = 0
                found = False
                if last_shift_doc:
                    for row in last_shift_doc.pump_meter_readings:
                        if row.pump_nozzle == nozzle.name:
                            opening_elec = row.closing_electronic_meter
                            opening_manual = row.closing_manual_meter
                            found = True
                            break
                            
                if not found and station_opening:
                    for row in station_opening.nozzle_balances:
                        if getattr(row, "pump_nozzle", None) == nozzle.name:
                            opening_elec = row.opening_electronic_meter
                            opening_manual = row.opening_manual_meter
                            break
                            
                self.append("pump_meter_readings", {
                    "pump_nozzle": nozzle.name,
                    "opening_electronic_meter": opening_elec,
                    "opening_manual_meter": opening_manual
                })

        if not self.dip_stick_readings and self.station:
            tanks = frappe.get_all("Fuel Tank", filters={"station": self.station}, fields=["name"])
            for tank in tanks:
                opening_dip = 0.0
                found = False
                if last_shift_doc:
                    for row in (last_shift_doc.dip_stick_readings or []):
                        if getattr(row, "fuel_tank", None) == tank.name:
                            opening_dip = row.closing_dip or 0.0
                            found = True
                            break
                            
                if not found and station_opening:
                    for row in (station_opening.get("dip_balances") or []):
                        if getattr(row, "fuel_tank", None) == tank.name:
                            opening_dip = row.opening_dip or 0.0
                            break
                            
                self.append("dip_stick_readings", {
                    "fuel_tank": tank.name,
                    "opening_dip": opening_dip
                })

        if not self.mpesa_payments and self.station:
            tills = frappe.get_all("M-Pesa Till", filters={"station": self.station, "is_active": 1}, fields=["name"])
            for till in tills:
                opening_bal = 0
                found = False
                if last_shift_doc:
                    for row in (last_shift_doc.mpesa_payments or []):
                        if getattr(row, "mpesa_till", None) == till.name:
                            opening_bal = row.closing_balance or 0
                            found = True
                            break
                            
                if not found and station_opening:
                    for row in (station_opening.mpesa_balances or []):
                        if getattr(row, "mpesa_till", None) == till.name:
                            opening_bal = row.opening_balance or 0
                            break
                self.append("mpesa_payments", {
                    "mpesa_till": till.name,
                    "opening_balance": opening_bal,
                    "closing_balance": 0,
                    "transfers_made": 0
                })

    def calculate_expected_stock(self):
        from frappe.utils import flt
        if self.station and self.dip_stick_readings:
            # Get all purchases for this shift
            shift_purchases = frappe.get_all("Station Purchase", filters={"shift": self.name, "docstatus": 1}, pluck="name")
            purchase_map = {}
            if shift_purchases:
                items = frappe.get_all("Station Purchase Item", filters={"parent": ["in", shift_purchases]}, fields=["item_code", "qty"])
                for item in items:
                    purchase_map[item.item_code] = purchase_map.get(item.item_code, 0) + flt(item.qty)

            for row in self.dip_stick_readings:
                tank = frappe.db.get_value("Fuel Tank", row.fuel_tank, ["fuel_product"], as_dict=True)
                
                sales = 0
                if self.pump_meter_readings:
                    for p in self.pump_meter_readings:
                        if p.pump_nozzle:
                            pump_tank = frappe.db.get_value("Pump Nozzle", p.pump_nozzle, "fuel_tank")
                            if pump_tank == row.fuel_tank:
                                sales += (p.sales_quantity_electronic or 0)
                                
                purchased_qty = 0
                if tank and tank.fuel_product:
                    purchased_qty = purchase_map.get(tank.fuel_product, 0)
                    
                row.expected_stock = flt(row.opening_dip) + purchased_qty - sales

    def create_stock_entry_on_close(self):
        if self.status == "Closed" and not self.stock_entry_reference:
            station_doc = frappe.get_doc("Fuel Station", self.station)
            if not station_doc.default_forecourt_warehouse:
                frappe.throw("Cannot deduct stock: Fuel Station missing Default Forecourt Warehouse.")

            sales_per_item = {}
            
            # Deduct Fuel Meter Sales
            for row in self.pump_meter_readings:
                if getattr(row, "sales_quantity_electronic", 0) and row.sales_quantity_electronic > 0:
                    tank_name = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                    if tank_name:
                        item_code = frappe.db.get_value("Fuel Tank", tank_name, "fuel_product")
                        if item_code:
                            sales_per_item[item_code] = sales_per_item.get(item_code, 0) + row.sales_quantity_electronic

            # Deduct Dry Stock / Inventory Sales
            for row in (self.inventory_sales or []):
                if getattr(row, "item", None) and getattr(row, "quantity", 0) and row.quantity > 0:
                    # Use total_volume as the base quantity if available, else fallback to quantity
                    qty = row.total_volume if getattr(row, "total_volume", 0) else row.quantity
                    sales_per_item[row.item] = sales_per_item.get(row.item, 0) + qty

            # Note: Credit Invoice Non-Fuel Items are already injected into inventory_sales
            # so we DO NOT iterate over self.invoices here, avoiding double-deduction!


            # Deduct Station Return To Tank Volumes (credit back to stock)
            rtt_records = frappe.get_all("Station Return To Tank", filters={"shift": self.name}, fields=["item", "volume_returned"])
            for rtt in rtt_records:
                if rtt.item and rtt.volume_returned:
                    sales_per_item[rtt.item] = sales_per_item.get(rtt.item, 0) - rtt.volume_returned

            if not sales_per_item or all(qty <= 0 for qty in sales_per_item.values()):
                return


            se = frappe.new_doc("Stock Entry")
            se.stock_entry_type = "Material Issue"
            se.purpose = "Material Issue"
            se.from_warehouse = station_doc.default_forecourt_warehouse
            se.remarks = f"Fuel Sales for Shift {self.name}"

            for item_code, qty in sales_per_item.items():
                company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
                se.append("items", {
                    "item_code": item_code,
                    "qty": qty,
                    "s_warehouse": station_doc.default_forecourt_warehouse,
                    "cost_center": frappe.get_cached_value("Company", company, "cost_center") or None,
                    "allow_zero_valuation_rate": 1
                })

            se.insert(ignore_permissions=True)
            se.submit()

            self.db_set("stock_entry_reference", se.name)
            frappe.msgprint(f"Stock Entry {se.name} automatically created to deduct fuel and inventory sales.")


    def create_topup_accounting_on_close(self):
        from frappe.utils import nowdate, flt
        
        if self.status != "Closed":
            return
            
        topups = frappe.get_all("Station Supplier Top Up", filters={"shift": self.name}, fields=["name", "card", "amount", "rrn_number", "mode_of_payment"])
        if not topups:
            return
            
        company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
        if not company:
            return
            
        default_cash_account = frappe.get_cached_value("Company", company, "default_cash_account")
        default_payable_account = frappe.get_cached_value("Company", company, "default_payable_account")
        
        if not default_payable_account:
            frappe.msgprint("Default Payable account not set in Company. Skipping Top-Up Accounting.")
            return

        # We will create one Journal Entry for all top-ups in this shift
        je = frappe.new_doc("Journal Entry")
        je.voucher_type = "Journal Entry"
        je.company = company
        je.posting_date = self.shift_date or nowdate()
        je.user_remark = f"Supplier Cash Top-Ups for Shift {self.name}"
        
        has_entries = False
        
        # Track debit amounts per account
        debit_accounts = {}
        
        for t in topups:
            amount = flt(t.amount)
            if amount <= 0: continue
            
            supplier = frappe.db.get_value("Supplier Card", t.card, "supplier")
            if not supplier: continue
            
            # Credit Supplier
            je.append("accounts", {
                "account": default_payable_account,
                "party_type": "Supplier",
                "party": supplier,
                "credit_in_account_currency": amount,
                "reference_type": "Station Supplier Top Up",
                "reference_name": t.name,
                "user_remark": f"Top-Up RRN: {t.rrn_number}"
            })
            
            # Determine Debit Account based on Mode of Payment
            debit_acct = default_cash_account
            if getattr(t, "mode_of_payment", None):
                mop_acct = frappe.db.get_value("Mode of Payment Account", {"parent": t.mode_of_payment, "company": company}, "default_account")
                if mop_acct:
                    debit_acct = mop_acct
            
            if not debit_acct:
                frappe.throw(f"No account found to Debit for Mode of Payment {t.mode_of_payment} or Default Cash Account is missing.")
                
            debit_accounts[debit_acct] = debit_accounts.get(debit_acct, 0.0) + amount
            has_entries = True
            
        if has_entries:
            # Debit Cash/MOP Accounts
            for acct, amt in debit_accounts.items():
                je.append("accounts", {
                    "account": acct,
                    "debit_in_account_currency": amt,
                    "user_remark": f"Total received for Supplier Top-Ups Shift {self.name}"
                })
            
            je.flags.ignore_permissions = True
            je.insert()
            je.submit()
            frappe.msgprint(f"Generated Journal Entry {je.name} for Supplier Cash Top-Ups.")

@frappe.whitelist()
def reopen_shift(shift_name):
    shift = frappe.get_doc("Shift", shift_name)
    if shift.status != "Closed": return
    
    # Cancel Stock Entry
    if shift.stock_entry_reference:
        se = frappe.get_doc("Stock Entry", shift.stock_entry_reference)
        if se.docstatus == 1:
            se.cancel()
        shift.db_set("stock_entry_reference", None)
        
    # Cancel Ledgers
    ledgers = frappe.get_all("Staff Liability Ledger", filters={"shift": shift_name})
    for l in ledgers:
        doc = frappe.get_doc("Staff Liability Ledger", l.name)
        if doc.docstatus == 1:
            doc.cancel()
            
    shift.db_set("status", "Open")
    frappe.msgprint("Shift reopened successfully. Accounting records cancelled.")


@frappe.whitelist()
def get_nozzle_prices(station, shift_date):
    """
    Returns a dictionary mapping nozzle names to their current item prices.
    Format: { "Nozzle Name": price, ... }
    """
    from frappe.utils import flt
    nozzle_prices = {}
    
    # 1. Get all Pump Groups for the station
    pump_groups = frappe.get_all("Pump Group", filters={"station": station}, pluck="name")
    if not pump_groups:
        return nozzle_prices
        
    # 2. Get all Nozzles in those groups
    nozzles = frappe.get_all("Pump Nozzle", filters={"pump_group": ["in", pump_groups]}, fields=["name", "fuel_tank"])
    
    # Cache to avoid duplicate queries for same fuel_product
    product_price_cache = {}
    
    for nozzle in nozzles:
        if not nozzle.fuel_tank:
            nozzle_prices[nozzle.name] = {"price": 0.0, "item": getattr(nozzle, "fuel_product", None)}
            continue
            
        fuel_product = frappe.db.get_value("Fuel Tank", nozzle.fuel_tank, "fuel_product")
        if not fuel_product:
            nozzle_prices[nozzle.name] = {"price": 0.0, "item": getattr(nozzle, "fuel_product", None)}
            continue
            
        if fuel_product in product_price_cache:
            nozzle_prices[nozzle.name] = product_price_cache[fuel_product]
        else:
            price_record = frappe.get_all("Item Price", 
                filters={
                    "item_code": fuel_product, 
                    "price_list": "Standard Selling", 
                    "valid_from": ("<=", shift_date)
                },
                fields=["price_list_rate"],
                order_by="valid_from desc",
                limit=1
            )
            price = flt(price_record[0].price_list_rate) if price_record else 0.0
            product_price_cache[fuel_product] = {"price": price, "item": fuel_product}
            nozzle_prices[nozzle.name] = {"price": price, "item": fuel_product}
            
    return nozzle_prices


@frappe.whitelist()
def get_till_pump_groups():
    return frappe.db.sql("SELECT parent, pump_group FROM `tabM-Pesa Till Pump Group` WHERE parenttype = 'M-Pesa Till'", as_dict=True)
