frappe.pages['debtors_dashboard'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Debtors Dashboard',
		single_column: true
	});

	// Load Vue 3 via CDN
	frappe.require('https://unpkg.com/vue@3/dist/vue.global.js', function() {
		setup_vue_app(page);
	});
};

function setup_vue_app(page) {
	// Create mount point
	$(page.body).html(`
		<div id="debtors-app"></div>
	`);

	const { createApp, ref, computed } = Vue;

	const app = createApp({
		template: `
			<div class="debtors-container">
				<!-- Dashboard View -->
				<div v-if="activeView === 'dashboard'">
					
					<!-- KPI Row -->
					<div class="kpi-row">
						<div class="kpi-card">
							<div class="kpi-title">Total Receivables</div>
							<div class="kpi-value">{{ formatCurrency(totalReceivables) }}</div>
						</div>
						<div class="kpi-card text-danger">
							<div class="kpi-title">Overdue Amount</div>
							<div class="kpi-value">{{ formatCurrency(totalOverdue) }}</div>
						</div>
						<div class="kpi-card text-warning">
							<div class="kpi-title">At Risk / Near Limit</div>
							<div class="kpi-value">{{ atRiskCount }} Customers</div>
						</div>
					</div>

					<!-- Filter Bar -->
					<div class="filter-bar">
						<div class="search-box">
							<input type="text" class="form-control" placeholder="Search Customer or Fleet ID..." v-model="searchQuery">
						</div>
						<div class="toggle-box checkbox">
							<label>
								<input type="checkbox" v-model="showOverdueOnly"> <span class="label-area">Show Overdue Only</span>
							</label>
						</div>
					</div>

					<!-- Data Table -->
					<div class="table-responsive">
						<table class="table table-bordered table-hover">
							<thead>
								<tr>
									<th>Customer Name</th>
									<th>Last Payment</th>
									<th class="text-right">Total Invoiced</th>
									<th class="text-right">Total Paid</th>
									<th class="text-right">Current Balance</th>
									<th class="text-center">Status</th>
									<th class="text-center">Actions</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="debtor in filteredDebtors" :key="debtor.id">
									<td class="font-weight-bold">
										<a href="#" @click.prevent="openStatement(debtor)">{{ debtor.name }}</a>
										<div class="text-muted small">Fleet ID: {{ debtor.fleet_id || 'N/A' }}</div>
									</td>
									<td>{{ debtor.last_payment_date }}</td>
									<td class="text-right">{{ formatCurrency(debtor.total_invoiced) }}</td>
									<td class="text-right">{{ formatCurrency(debtor.total_paid) }}</td>
									<td class="text-right font-weight-bold">{{ formatCurrency(debtor.balance) }}</td>
									<td class="text-center">
										<span :class="['indicator', getStatusColor(debtor.status)]">{{ debtor.status }}</span>
									</td>
									<td class="text-center">
										<button class="btn btn-xs btn-default" @click="openStatement(debtor)">Statement</button>
									</td>
								</tr>
								<tr v-if="filteredDebtors.length === 0">
									<td colspan="7" class="text-center text-muted">No debtors found.</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<!-- Statement Detail View -->
				<div v-if="activeView === 'statement'">
					
					<!-- Header Section -->
					<div class="statement-header">
						<div>
							<button class="btn btn-sm btn-default" @click="activeView = 'dashboard'">
								<svg class="icon icon-sm"><use href="#icon-arrow-left"></use></svg> Back to Dashboard
							</button>
							<h2 class="mt-3">{{ selectedDebtor.name }}</h2>
							<div class="text-muted">Credit Limit: <strong>{{ formatCurrency(selectedDebtor.credit_limit) }}</strong></div>
						</div>
						<div class="statement-actions">
							<button class="btn btn-default mr-2" @click="printStatement">Download PDF</button>
							<button class="btn btn-primary" @click="emailStatement">Email to Customer</button>
						</div>
					</div>

					<!-- Controls -->
					<div class="statement-controls mt-4">
						<div class="row">
							<div class="col-md-3">
								<div class="form-group">
									<label>Start Date</label>
									<input type="date" class="form-control" v-model="startDate">
								</div>
							</div>
							<div class="col-md-3">
								<div class="form-group">
									<label>End Date</label>
									<input type="date" class="form-control" v-model="endDate">
								</div>
							</div>
						</div>
					</div>

					<!-- Summary Section -->
					<div class="statement-summary mt-3">
						<div class="row text-center">
							<div class="col-md-3">
								<div class="text-muted small uppercase">Opening Balance</div>
								<div class="h4">{{ formatCurrency(openingBalance) }}</div>
							</div>
							<div class="col-md-3">
								<div class="text-muted small uppercase">Total Debits</div>
								<div class="h4">{{ formatCurrency(periodDebits) }}</div>
							</div>
							<div class="col-md-3">
								<div class="text-muted small uppercase">Total Credits</div>
								<div class="h4">{{ formatCurrency(periodCredits) }}</div>
							</div>
							<div class="col-md-3">
								<div class="text-muted small uppercase">Closing Balance</div>
								<div class="h4 font-weight-bold">{{ formatCurrency(closingBalance) }}</div>
							</div>
						</div>
					</div>

					<!-- Transaction Table -->
					<div class="table-responsive mt-4">
						<table class="table table-bordered table-striped">
							<thead>
								<tr>
									<th>Date</th>
									<th>Reference Type</th>
									<th>Description</th>
									<th class="text-right">Debit</th>
									<th class="text-right">Credit</th>
									<th class="text-right">Running Balance</th>
								</tr>
							</thead>
							<tbody>
								<tr class="table-info">
									<td colspan="5" class="text-right font-weight-bold">Opening Balance</td>
									<td class="text-right font-weight-bold">{{ formatCurrency(openingBalance) }}</td>
								</tr>
								<tr v-for="(txn, index) in processedTransactions" :key="index">
									<td>{{ txn.date }}</td>
									<td>{{ txn.ref_type }}</td>
									<td>{{ txn.description }}</td>
									<td class="text-right">{{ txn.debit ? formatCurrency(txn.debit) : '-' }}</td>
									<td class="text-right">{{ txn.credit ? formatCurrency(txn.credit) : '-' }}</td>
									<td class="text-right font-weight-bold">{{ formatCurrency(txn.running_balance) }}</td>
								</tr>
								<tr v-if="processedTransactions.length === 0">
									<td colspan="6" class="text-center text-muted">No transactions in this period.</td>
								</tr>
							</tbody>
						</table>
					</div>

				</div>
			</div>
		`,
		setup() {
			const activeView = ref('dashboard');
			const searchQuery = ref('');
			const showOverdueOnly = ref(false);
			const selectedDebtor = ref(null);
			const startDate = ref('2026-08-01');
			const endDate = ref('2026-08-31');

			// Mock Data: Debtors
			const debtors = ref([
				{ id: 1, name: 'Acme Logistics Ltd', fleet_id: 'FLT-001', last_payment_date: '2026-08-02', total_invoiced: 450000, total_paid: 300000, balance: 150000, status: 'Near Limit', credit_limit: 160000 },
				{ id: 2, name: 'Global Transport Corp', fleet_id: 'FLT-042', last_payment_date: '2026-07-15', total_invoiced: 800000, total_paid: 500000, balance: 300000, status: 'Overdue', credit_limit: 250000 },
				{ id: 3, name: 'Swift Delivery Services', fleet_id: 'FLT-103', last_payment_date: '2026-08-05', total_invoiced: 120000, total_paid: 120000, balance: 0, status: 'Safe', credit_limit: 100000 },
				{ id: 4, name: 'County Government Transport', fleet_id: 'FLT-099', last_payment_date: '2026-06-10', total_invoiced: 1500000, total_paid: 900000, balance: 600000, status: 'Overdue', credit_limit: 500000 },
				{ id: 5, name: 'Apex Hauliers', fleet_id: 'FLT-015', last_payment_date: '2026-08-01', total_invoiced: 300000, total_paid: 250000, balance: 50000, status: 'Safe', credit_limit: 200000 },
			]);

			// Mock Data: Transactions
			const allTransactions = ref([
				{ id: 101, customer_id: 1, date: '2026-07-28', ref_type: 'Shift Invoice', description: 'INV001 - KCA 123A - Diesel', debit: 50000, credit: 0 },
				{ id: 102, customer_id: 1, date: '2026-07-29', ref_type: 'Shift Invoice', description: 'INV002 - KCB 456B - Petrol', debit: 30000, credit: 0 },
				{ id: 103, customer_id: 1, date: '2026-07-30', ref_type: 'Customer Payment', description: 'Bank Transfer Receipt', debit: 0, credit: 80000 },
				{ id: 104, customer_id: 1, date: '2026-08-02', ref_type: 'Shift Invoice', description: 'INV055 - KCC 789C - Diesel', debit: 150000, credit: 0 },
				{ id: 105, customer_id: 2, date: '2026-07-01', ref_type: 'Shift Invoice', description: 'INV010 - KDD 001D - Diesel', debit: 300000, credit: 0 },
				{ id: 106, customer_id: 2, date: '2026-07-15', ref_type: 'Customer Payment', description: 'Cheque Deposit', debit: 0, credit: 100000 },
			]);

			// Computed properties for Dashboard
			const filteredDebtors = computed(() => {
				return debtors.value.filter(d => {
					const matchSearch = d.name.toLowerCase().includes(searchQuery.value.toLowerCase()) || 
										(d.fleet_id && d.fleet_id.toLowerCase().includes(searchQuery.value.toLowerCase()));
					const matchToggle = showOverdueOnly.value ? d.status === 'Overdue' : true;
					return matchSearch && matchToggle;
				});
			});

			const totalReceivables = computed(() => {
				return debtors.value.reduce((sum, d) => sum + d.balance, 0);
			});

			const totalOverdue = computed(() => {
				return debtors.value.filter(d => d.status === 'Overdue').reduce((sum, d) => sum + d.balance, 0);
			});

			const atRiskCount = computed(() => {
				return debtors.value.filter(d => d.status === 'Near Limit').length;
			});

			// Computed properties for Statement View
			const customerTransactions = computed(() => {
				if (!selectedDebtor.value) return [];
				// Sort chronologically
				return allTransactions.value
					.filter(t => t.customer_id === selectedDebtor.value.id)
					.sort((a, b) => new Date(a.date) - new Date(b.date));
			});

			const openingBalance = computed(() => {
				let bal = 0;
				for (let t of customerTransactions.value) {
					if (new Date(t.date) < new Date(startDate.value)) {
						bal += (t.debit || 0) - (t.credit || 0);
					}
				}
				return bal;
			});

			const processedTransactions = computed(() => {
				let currentBalance = openingBalance.value;
				let result = [];
				for (let t of customerTransactions.value) {
					if (new Date(t.date) >= new Date(startDate.value) && new Date(t.date) <= new Date(endDate.value)) {
						currentBalance += (t.debit || 0) - (t.credit || 0);
						result.push({
							...t,
							running_balance: currentBalance
						});
					}
				}
				return result;
			});

			const periodDebits = computed(() => {
				return processedTransactions.value.reduce((sum, t) => sum + (t.debit || 0), 0);
			});

			const periodCredits = computed(() => {
				return processedTransactions.value.reduce((sum, t) => sum + (t.credit || 0), 0);
			});

			const closingBalance = computed(() => {
				return openingBalance.value + periodDebits.value - periodCredits.value;
			});

			// Methods
			const formatCurrency = (val) => {
				if (val === null || val === undefined) return '';
				return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(val);
			};

			const getStatusColor = (status) => {
				if (status === 'Overdue') return 'red';
				if (status === 'Near Limit') return 'orange';
				return 'green';
			};

			const openStatement = (debtor) => {
				selectedDebtor.value = debtor;
				activeView.value = 'statement';
			};

			const printStatement = () => {
				// In a real implementation, this would route to /printview?doctype=Customer&name=xxx&format=Fuel%20Debtor%20Statement
				frappe.msgprint("Opening print view (mocked)");
			};

			const emailStatement = () => {
				frappe.msgprint(`Emailing statement to ${selectedDebtor.value.name}`);
			};

			return {
				activeView, searchQuery, showOverdueOnly, selectedDebtor, startDate, endDate,
				filteredDebtors, totalReceivables, totalOverdue, atRiskCount,
				openingBalance, processedTransactions, periodDebits, periodCredits, closingBalance,
				formatCurrency, getStatusColor, openStatement, printStatement, emailStatement
			};
		}
	});

	app.mount('#debtors-app');
}
