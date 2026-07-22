import frappe
from frappe.model.document import Document

class Shift(Document):
    def validate(self):
        self.auto_set_shift_display()
        self.validate_future_date()
        self.lock_shift_if_closed_for_csa()
        self.lock_active_shift_overlap()
        self.auto_fetch_opening_readings()
        self.calculate_expected_stock()
        self.calculate_expected_cash()

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
                total_mpesa += row.amount

        total_cards = sum(flt(row.amount) for row in (self.card_payments or []))
        total_invoices = sum(flt(row.amount) for row in (self.invoices or []))
        total_expenses = sum(flt(row.amount) for row in (self.shift_expenses or []))
        total_procurement = sum(flt(row.amount) for row in (self.procurement or []))

        # Deduct Fleet Card CSA Drops
        total_fleet_drops = 0.0
        if not self.is_new():
            fleet_summaries = frappe.get_all("Fleet Card Shift Summary", filters={"shift": self.name, "docstatus": ("<", 2)}, fields=["total_csa_drops"])
            for s in fleet_summaries:
                total_fleet_drops += flt(s.total_csa_drops)

        self.expected_cash = total_fuel_amount - (total_mpesa + total_cards + total_invoices + total_expenses + total_procurement + total_fleet_drops)

        if getattr(self, "actual_cash", None) is not None:
            self.cash_variance = flt(self.actual_cash) - flt(self.expected_cash)
            
        if getattr(self, "actual_dry_stock_cash", None) is not None:
            self.dry_stock_cash_variance = flt(self.actual_dry_stock_cash) - flt(self.expected_dry_stock_cash)

    def on_update(self):
        self.create_stock_entry_on_close()
        self.post_cash_variance_to_liability_ledger()

    def post_cash_variance_to_liability_ledger(self):
        # 1. Fuel Variance
        if self.status == "Closed" and getattr(self, "cash_variance", 0) and self.cash_variance < 0:
            csas = [row.csa for row in (self.assigned_csas or []) if row.csa and "Lube" not in (row.pump_group or "")]
            if csas:
                split_amount = abs(self.cash_variance) / len(csas)
                for csa in csas:
                    existing = frappe.db.exists("Staff Liability Ledger", {"shift": self.name, "employee": csa, "reason": ("like", "%Fuel%")})
                    if not existing:
                        ledger = frappe.new_doc("Staff Liability Ledger")
                        ledger.employee = csa
                        ledger.date = self.shift_date
                        ledger.shift = self.name
                        ledger.amount = split_amount
                        ledger.reason = f"Fuel Cash Variance Shortfall for Shift {self.name}"
                        ledger.insert(ignore_permissions=True)
                        ledger.submit()
                        frappe.msgprint(f"Staff Liability Ledger created for CSA {csa} (Fuel) for shortfall of {split_amount}")

        # 2. Dry Stock Variance
        if self.status == "Closed" and getattr(self, "dry_stock_cash_variance", 0) and self.dry_stock_cash_variance < 0:
            lubes_csa = None
            for row in (self.assigned_csas or []):
                if row.pump_group and "Lube" in row.pump_group:
                    lubes_csa = row.csa
                    break
            
            if lubes_csa:
                existing = frappe.db.exists("Staff Liability Ledger", {"shift": self.name, "employee": lubes_csa, "reason": ("like", "%Dry Stock%")})
                if not existing:
                    ledger = frappe.new_doc("Staff Liability Ledger")
                    ledger.employee = lubes_csa
                    ledger.date = self.shift_date
                    ledger.shift = self.name
                    ledger.amount = abs(self.dry_stock_cash_variance)
                    ledger.reason = f"Dry Stock Cash Variance Shortfall for Shift {self.name}"
                    ledger.insert(ignore_permissions=True)
                    ledger.submit()
                    frappe.msgprint(f"Staff Liability Ledger created for CSA {lubes_csa} (Dry Stock) for shortfall of {abs(self.dry_stock_cash_variance)}")

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
        if self.station and self.dip_stick_readings:
            station_doc = frappe.get_doc("Fuel Station", self.station)
            if not station_doc.default_forecourt_warehouse:
                return

            for row in self.dip_stick_readings:
                tank = frappe.db.get_value("Fuel Tank", row.fuel_tank, ["fuel_product"], as_dict=True)
                if tank and tank.fuel_product:
                    bin_qty = frappe.db.get_value("Bin", {"item_code": tank.fuel_product, "warehouse": station_doc.default_forecourt_warehouse}, "actual_qty") or 0.0
                    
                    sales = 0
                    if self.pump_meter_readings:
                        for p in self.pump_meter_readings:
                            if p.pump_nozzle:
                                pump_tank = frappe.db.get_value("Pump Nozzle", p.pump_nozzle, "fuel_tank")
                                if pump_tank == row.fuel_tank:
                                    sales += (p.sales_quantity_electronic or 0)
                                
                    row.expected_stock = bin_qty - sales

    def create_stock_entry_on_close(self):
        if self.status == "Closed" and not self.stock_entry_reference:
            station_doc = frappe.get_doc("Fuel Station", self.station)
            if not station_doc.default_forecourt_warehouse:
                frappe.throw("Cannot deduct stock: Fuel Station missing Default Forecourt Warehouse.")

            sales_per_item = {}
            for row in self.pump_meter_readings:
                if row.sales_quantity_electronic and row.sales_quantity_electronic > 0:
                    tank_name = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank")
                    if tank_name:
                        item_code = frappe.db.get_value("Fuel Tank", tank_name, "fuel_product")
                        if item_code:
                            sales_per_item[item_code] = sales_per_item.get(item_code, 0) + row.sales_quantity_electronic

            if not sales_per_item:
                return

            se = frappe.new_doc("Stock Entry")
            se.stock_entry_type = "Material Issue"
            se.purpose = "Material Issue"
            se.from_warehouse = station_doc.default_forecourt_warehouse
            se.remarks = f"Fuel Sales for Shift {self.name}"

            for item_code, qty in sales_per_item.items():
                se.append("items", {
                    "item_code": item_code,
                    "qty": qty,
                    "s_warehouse": station_doc.default_forecourt_warehouse,
                    "cost_center": frappe.db.get_single_value("Global Defaults", "default_cost_center") or None
                })

            se.insert(ignore_permissions=True)
            se.submit()

            self.db_set("stock_entry_reference", se.name)
            frappe.msgprint(f"Stock Entry {se.name} automatically created to deduct fuel sales.")

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
            nozzle_prices[nozzle.name] = 0.0
            continue
            
        fuel_product = frappe.db.get_value("Fuel Tank", nozzle.fuel_tank, "fuel_product")
        if not fuel_product:
            nozzle_prices[nozzle.name] = 0.0
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
            product_price_cache[fuel_product] = price
            nozzle_prices[nozzle.name] = price
            
    return nozzle_prices
