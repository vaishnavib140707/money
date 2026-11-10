
/* =========================================
   MIDNIGHT MONEY
   Complete monthly budget + savings tracker
========================================= */


// 1. MONTHLY DATA STORAGE

const now = new Date();

const monthKey =
    now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0");

const storageKey = "midnight-money-" + monthKey;


function loadData() {
    try {
        const saved = localStorage.getItem(storageKey);

        if (saved) {
            const parsed = JSON.parse(saved);

            if (
                typeof parsed.income === "number" &&
                Array.isArray(parsed.bills) &&
                Array.isArray(parsed.expenses)
            ) {
                return {
                    income: parsed.income,
                    bills: parsed.bills,
                    expenses: parsed.expenses,
                    savings: Array.isArray(parsed.savings)
                        ? parsed.savings
                        : [],
                    closedDays: Array.isArray(parsed.closedDays)
                        ? parsed.closedDays
                        : []
                };
            }
        }
    } catch (error) {
        console.error("Could not load budget:", error);
    }

    return {
        income: 0,
        bills: [],
        expenses: [],
        savings: [],
        closedDays: []
    };
}


let budget = {
    income: 0,
    bills: [],
    expenses: [],
    savings: [],
    closedDays: []
};

let budgetSaveQueue = Promise.resolve();
function saveData() {
    const snapshot = JSON.parse(JSON.stringify(budget));
    try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch (error) {
        console.error("Local budget backup failed:", error);
    }

    budgetSaveQueue = budgetSaveQueue.catch(() => {}).then(async () => {
        const user = await dashboardSessionReady;
        if (!user) throw new Error("Not logged in");
        const { error } = await dashboardSupabase
            .from("monthly_budgets")
            .upsert({
                user_id: user.id,
                month: monthKey,
                budget_data: snapshot
            }, { onConflict: "user_id,month" });
        if (error) throw error;
    }).catch(error => {
        console.error("Cloud budget save failed:", error);
        alert("Budget cloud save failed. Check your connection and try saving again.");
        throw error;
    });
}

async function loadCloudBudget(user) {
    const { data, error } = await dashboardSupabase
        .from("monthly_budgets")
        .select("budget_data")
        .eq("user_id", user.id)
        .eq("month", monthKey)
        .maybeSingle();

    if (error) {
        throw new Error("Could not load budget: " + error.message);
    }

    if (!data) {
        // New user or first month: start with an empty budget.
        return {
            income: 0,
            bills: [],
            expenses: [],
            savings: [],
            closedDays: []
        };
    }

    const saved = data.budget_data;

    if (
        !saved ||
        typeof saved.income !== "number" ||
        !Array.isArray(saved.bills) ||
        !Array.isArray(saved.expenses) ||
        !Array.isArray(saved.savings) ||
        !Array.isArray(saved.closedDays)
    ) {
        throw new Error("Cloud budget has an invalid format.");
    }

    return saved;
}

async function loadCloudGoals(user) {
    const { data, error } = await dashboardSupabase
        .from("savings_goals")
        .select("goals_data")
        .eq("user_id", user.id)
        .maybeSingle();

    if (error) {
        throw new Error("Could not load savings goals: " + error.message);
    }

    if (!data) return [];

    if (!Array.isArray(data.goals_data)) {
        throw new Error("Cloud savings goals have an invalid format.");
    }

    return data.goals_data;
}

// 2. HELPER FUNCTIONS


function formatMoney(amount) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2
    }).format(amount);
}


function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return replacements[character];
    });
}


function getTodayString() {
    const today = new Date();

    return today.getFullYear() + "-" +
        String(today.getMonth() + 1).padStart(2, "0") + "-" +
        String(today.getDate()).padStart(2, "0");
}


function getDaysRemaining() {
    const today = new Date();

    const nextMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        1
    );

    const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );

    return Math.max(
        1,
        Math.round((nextMonth - todayStart) / 86400000)
    );
}


function getExpensesForDate(date) {
    return budget.expenses
        .filter(expense => expense.date === date)
        .reduce((total, expense) => total + expense.amount, 0);
}


function getClosedDay(date) {
    return budget.closedDays.find(day => day.date === date);
}


function getSavingsTotal() {
    return budget.savings.reduce(
        (total, entry) => total + entry.amount,
        0
    );
}


// 3. BUDGET CALCULATIONS


function getTotals() {
    const billsTotal = budget.bills.reduce(
        (total, bill) => total + bill.amount,
        0
    );

    const spentTotal = budget.expenses.reduce(
        (total, expense) => total + expense.amount,
        0
    );

    const savingsTotal = getSavingsTotal();

    // Savings are separate and cannot be used for spending.
    const available =
        budget.income -
        billsTotal -
        spentTotal -
        savingsTotal;

    const days = getDaysRemaining();
    const today = getTodayString();

    const closedToday = Boolean(getClosedDay(today));
    const spentToday = getExpensesForDate(today);

    let dailyAllowance;

    if (closedToday) {
        // Today's budget is already closed.
        // Distribute the remaining spending balance over future days.
        const futureDays = Math.max(0, days - 1);

        dailyAllowance = futureDays > 0
            ? Math.max(0, available) / futureDays
            : 0;
    } else {
        // Keep today's target stable while purchases are being made.
        // Previous spending and savings are already reflected in available.
        const balanceBeforeToday = available + spentToday;

        dailyAllowance = days > 0
            ? Math.max(0, balanceBeforeToday) / days
            : 0;
    }

    return {
        billsTotal,
        spentTotal,
        savingsTotal,
        available,
        days,
        dailyAllowance,
        closedToday
    };
}


// 4. MONTH LABEL


function showMonth() {
    document.getElementById("monthLabel").textContent =
        new Date().toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric"
        });
}


// 5. MAIN DASHBOARD


function renderDashboard() {
    const totals = getTotals();

    document.getElementById("income").value =
        budget.income || "";

    document.getElementById("totalIncome").textContent =
        formatMoney(budget.income);

    document.getElementById("totalBills").textContent =
        formatMoney(totals.billsTotal);

    document.getElementById("totalSpent").textContent =
        formatMoney(totals.spentTotal);

    document.getElementById("availableBalance").textContent =
        formatMoney(totals.available);

    document.getElementById("dailyAllowance").innerHTML =
        `${formatMoney(totals.dailyAllowance)} <span>/ day</span>`;

    document.getElementById("daysRemaining").textContent =
        totals.closedToday
            ? `${Math.max(0, totals.days - 1)} future spending day(s) remaining.`
            : `${totals.days} spending day(s) remaining, including today.`;

    // Today's budget can only be closed once.
    const closeButton = document.getElementById("closeDayButton");

    closeButton.disabled = totals.closedToday;

    closeButton.textContent = totals.closedToday
        ? "Today's budget is closed ✓"
        : "Finish today's budget";

    // Monthly progress includes bills, expenses and savings.
    const totalUsed =
        totals.billsTotal +
        totals.spentTotal +
        totals.savingsTotal;

    const percentage = budget.income > 0
        ? (totalUsed / budget.income) * 100
        : 0;

    document.getElementById("progressBar").style.width =
        Math.min(100, Math.max(0, percentage)) + "%";

    document.getElementById("progressLabel").textContent =
        `${Math.round(percentage)}% used`;

    const progressCaption =
        document.getElementById("progressCaption");

    if (budget.income <= 0) {
        progressCaption.textContent =
            "Enter your income to see your monthly spending progress.";
    } else if (totals.available < 0) {
        progressCaption.textContent =
            `You are over budget by ${formatMoney(-totals.available)}.`;
    } else {
        progressCaption.textContent =
            `${formatMoney(totalUsed)} allocated or spent out of ` +
            `${formatMoney(budget.income)}.`;
    }

    document.getElementById("savingsTotal").textContent =
        formatMoney(totals.savingsTotal);

    renderBills();
    renderExpenses();
    renderSavings();
}


// 6. DISPLAY MONTHLY BILLS


function renderBills() {
    const billList = document.getElementById("billList");

    if (budget.bills.length === 0) {
        billList.innerHTML =
            '<p class="empty-state">No bills added yet.</p>';
        return;
    }

    billList.innerHTML = budget.bills.map(function (bill) {
        return `
            <div class="list-item">
                <div class="item-info">
                    <div class="item-name">
                        ${escapeHTML(bill.name)}
                    </div>
                    <div class="item-meta">
                        Reserved for this month
                    </div>
                </div>

                <div class="item-right">
                    <span class="item-amount">
                        ${formatMoney(bill.amount)}
                    </span>

                    <button
                        class="delete-button"
                        data-delete-bill="${escapeHTML(bill.id)}"
                        type="button">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join("");
}


// 7. DISPLAY DAILY EXPENSES


function renderExpenses() {
    const expenseList = document.getElementById("expenseList");

    const sortedExpenses = [...budget.expenses].sort(
        (a, b) => b.date.localeCompare(a.date)
    );

    document.getElementById("transactionCount").textContent =
        `${budget.expenses.length} transaction(s)`;

    if (sortedExpenses.length === 0) {
        expenseList.innerHTML =
            '<p class="empty-state">Your transactions will appear here.</p>';
        return;
    }

    expenseList.innerHTML = sortedExpenses.map(function (expense) {
        return `
            <div class="list-item">
                <div class="item-info">
                    <div class="item-name">
                        ${escapeHTML(expense.name)}
                    </div>

                    <div class="item-meta">
                        ${escapeHTML(expense.category)} ·
                        ${escapeHTML(expense.date)}
                    </div>
                </div>

                <div class="item-right">
                    <span class="item-amount">
                        −${formatMoney(expense.amount)}
                    </span>

                    <button
                        class="delete-button"
                        data-delete-expense="${escapeHTML(expense.id)}"
                        type="button">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join("");
}


// 8. DISPLAY SAVINGS


function renderSavings() {
    const savingsList = document.getElementById("savingsList");

    if (budget.savings.length === 0) {
        savingsList.innerHTML =
            '<p class="empty-state">Your savings will appear here.</p>';
        return;
    }

    const sortedSavings = [...budget.savings].sort(
        (a, b) => b.date.localeCompare(a.date)
    );

    savingsList.innerHTML = sortedSavings.map(function (entry) {
        return `
            <div class="list-item">
                <div class="item-info">
                    <div class="item-name">
                        Daily savings
                    </div>

                    <div class="item-meta">
                        ${escapeHTML(entry.date)}
                    </div>
                </div>

                <span class="item-amount" style="color: var(--success)">
                    +${formatMoney(entry.amount)}
                </span>
            </div>
        `;
    }).join("");
}


// 9. KEEP CLOSED-DAY SAVINGS ACCURATE


function updateSavingsForDate(date) {
    const closedDay = getClosedDay(date);

    // Do not create savings for a day that is still open.
    if (!closedDay) return;

    const spent = getExpensesForDate(date);

    // Savings cannot be negative.
    const savedAmount = Math.max(
        0,
        closedDay.allowance - spent
    );

    const existingEntry = budget.savings.find(
        entry => entry.date === date
    );

    if (savedAmount > 0) {
        if (existingEntry) {
            existingEntry.amount = savedAmount;
        } else {
            budget.savings.push({
                id: crypto.randomUUID(),
                date: date,
                amount: savedAmount
            });
        }
    } else {
        budget.savings = budget.savings.filter(
            entry => entry.date !== date
        );
    }
}


// 10. SAVE MONTHLY INCOME


document.getElementById("incomeForm").addEventListener(
    "submit",
    function (event) {
        event.preventDefault();

        const income = Number(
            document.getElementById("income").value
        );

        if (!Number.isFinite(income) || income < 0) {
            alert("Please enter a valid income amount.");
            return;
        }

        const totals = getTotals();

        if (
            income <
            totals.billsTotal +
            totals.spentTotal +
            totals.savingsTotal
        ) {
            const confirmed = confirm(
                "Your income will be lower than your bills, spending " +
                "and savings. This will put your budget over its limit. " +
                "Continue?"
            );

            if (!confirmed) return;
        }

        budget.income = income;

        saveData();
        renderDashboard();
    }
);


// 11. ADD MONTHLY BILLS


document.getElementById("billForm").addEventListener(
    "submit",
    function (event) {
        event.preventDefault();

        const name =
            document.getElementById("billName").value.trim();

        const amount = Number(
            document.getElementById("billAmount").value
        );

        if (!name || !Number.isFinite(amount) || amount <= 0) {
            alert("Enter a bill name and a valid amount.");
            return;
        }

        budget.bills.push({
            id: crypto.randomUUID(),
            name: name,
            amount: amount
        });

        saveData();
        renderDashboard();

        document.getElementById("billForm").reset();
    }
);


// 12. ADD DAILY EXPENSES


document.getElementById("expenseForm").addEventListener(
    "submit",
    function (event) {
        event.preventDefault();

        const name =
            document.getElementById("expenseName").value.trim();

        const amount = Number(
            document.getElementById("expenseAmount").value
        );

        const category =
            document.getElementById("expenseCategory").value;

        const date =
            document.getElementById("expenseDate").value;

        if (
            !name ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !date ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {
            alert("Enter a description, valid amount and date.");
            return;
        }

        if (date.slice(0, 7) !== monthKey) {
            alert("Choose a date within the current month.");
            return;
        }

        const expenseDate = new Date(date + "T00:00:00");

        if (
            Number.isNaN(expenseDate.getTime()) ||
            expenseDate.getFullYear() + "-" +
                String(expenseDate.getMonth() + 1).padStart(2, "0")
                !== monthKey ||
            expenseDate.getDate() !== Number(date.slice(8, 10))
        ) {
            alert("Please enter a valid date.");
            return;
        }

        // A closed day cannot be reopened by adding another expense.
        if (getClosedDay(date)) {
            alert(
                "This day's budget is closed. You cannot add another " +
                "expense to it. Your savings remain protected."
            );
            return;
        }

        budget.expenses.push({
            id: crypto.randomUUID(),
            name: name,
            amount: amount,
            category: category,
            date: date
        });

        saveData();
        renderDashboard();

        document.getElementById("expenseForm").reset();
        document.getElementById("expenseDate").value = getTodayString();
    }
);


// 13. DELETE MONTHLY BILLS


document.getElementById("billList").addEventListener(
    "click",
    function (event) {
        const button = event.target.closest("[data-delete-bill]");

        if (!button) return;

        const id = button.dataset.deleteBill;

        budget.bills = budget.bills.filter(
            bill => bill.id !== id
        );

        saveData();
        renderDashboard();
    }
);


// 14. DELETE DAILY EXPENSES


document.getElementById("expenseList").addEventListener(
    "click",
    function (event) {
        const button =
            event.target.closest("[data-delete-expense]");

        if (!button) return;

        const id = button.dataset.deleteExpense;

        const removedExpense = budget.expenses.find(
            expense => expense.id === id
        );

        if (!removedExpense) return;

        // Keep the savings record if a closed day's expense is deleted.
        // Savings are protected once the day is closed.
        budget.expenses = budget.expenses.filter(
            expense => expense.id !== id
        );

        saveData();
        renderDashboard();
    }
);


// 15. CLOSE TODAY'S BUDGET


document.getElementById("closeDayButton").addEventListener(
    "click",
    function () {
        if (budget.income <= 0) {
            alert("Please set your monthly income first.");
            return;
        }

        const today = getTodayString();

        if (getClosedDay(today)) {
            alert("Today's budget has already been closed.");
            return;
        }

        const totals = getTotals();
        const spentToday = getExpensesForDate(today);

        const savedAmount = Math.max(
            0,
            totals.dailyAllowance - spentToday
        );

        // Record today's allowance so it cannot be changed later.
        budget.closedDays.push({
            date: today,
            allowance: totals.dailyAllowance
        });

        // Only leftover money enters savings.
        if (savedAmount > 0) {
            budget.savings.push({
                id: crypto.randomUUID(),
                date: today,
                amount: savedAmount
            });
        }

        saveData();
        renderDashboard();

        if (savedAmount > 0) {
            alert(
                `${formatMoney(savedAmount)} added to your savings!`
            );
        } else {
            alert(
                "Today's budget is closed. Your remaining spending " +
                "money will be recalculated for future days."
            );
        }
    }
);


// 16. SET TODAY'S DATE


function setTodayDate() {
    const dateInput = document.getElementById("expenseDate");

    const today = getTodayString();

    const lastDay = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0
    ).getDate();

    dateInput.value = today;
    dateInput.min = monthKey + "-01";

    dateInput.max =
        monthKey + "-" + String(lastDay).padStart(2, "0");
}


// 17. START THE WEBSITE


showMonth();
setTodayDate();


// ==================================
// MIDNIGHT MONEY — DATA BACKUP
// ==================================

const exportBackupButton = document.getElementById("exportBackup");

if (exportBackupButton) {

    exportBackupButton.addEventListener("click", function () {

        const backup = {};

        const prefix = "midnight-money-";

        // Collect all Midnight Money monthly records
        for (let i = 0; i < localStorage.length; i++) {

            const key = localStorage.key(i);

            if (key && key.startsWith(prefix)) {

                backup[key] = JSON.parse(
                    localStorage.getItem(key)
                );

            }
        }

        if (Object.keys(backup).length === 0) {
            alert("No budget data found to export.");
            return;
        }

        // Create a downloadable JSON file
        const backupFile = new Blob(
            [JSON.stringify(backup, null, 2)],
            { type: "application/json" }
        );

        const downloadURL = URL.createObjectURL(backupFile);

        const link = document.createElement("a");

        link.href = downloadURL;

        link.download = "midnight-money-backup.json";

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        URL.revokeObjectURL(downloadURL);

        alert("Your Midnight Money backup has been downloaded!");

    });

}

// ==================================
// MIDNIGHT MONEY — SAVINGS GOALS
// ==================================

const goalsStorageKey = "midnight-money-savings-goals";

let savingsGoals = [];

const goalForm = document.getElementById("goalForm");
const goalsList = document.getElementById("goalsList");

const goalCurrency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
});

let goalsSaveQueue = Promise.resolve();
function saveGoals() {
    const snapshot = JSON.parse(JSON.stringify(savingsGoals));
    try {
        localStorage.setItem(goalsStorageKey, JSON.stringify(snapshot));
    } catch (error) {
        console.error("Local savings goals backup failed:", error);
    }

    goalsSaveQueue = goalsSaveQueue.catch(() => {}).then(async () => {
        const user = await dashboardSessionReady;
        if (!user) throw new Error("Not logged in");
        const { error } = await dashboardSupabase
            .from("savings_goals")
            .upsert({
                user_id: user.id,
                goals_data: snapshot
            }, { onConflict: "user_id" });
        if (error) throw error;
    }).catch(error => {
        console.error("Cloud savings goals save failed:", error);
        alert("Savings goals cloud save failed. Check your connection and try again.");
        throw error;
    });
}

function renderGoals() {

    if (!goalsList) return;

    if (savingsGoals.length === 0) {
        goalsList.innerHTML = `
            <p class="empty-state">
                No savings goals yet. Create your first goal above!
            </p>
        `;
        return;
    }

    goalsList.innerHTML = savingsGoals.map(goal => {

        const percentage = Math.min(
            100,
            (goal.saved / goal.target) * 100
        );

        const completed = goal.saved >= goal.target;

        return `
            <article class="goal-card" data-goal-id="${goal.id}">

                <div class="goal-card-top">
                    <div>
                        <h3>${escapeHTML(goal.name)}</h3>

                        <p class="goal-amount">
                            ${goalCurrency.format(goal.saved)}
                            <span class="muted">
                                of ${goalCurrency.format(goal.target)}
                            </span>
                        </p>
                    </div>

                    <span class="goal-progress-label">
                        ${completed ? "Completed ✦" : Math.round(percentage) + "%"}
                    </span>
                </div>

                <div class="goal-progress-track">
                    <div
                        class="goal-progress-fill"
                        style="width: ${percentage}%"
                    ></div>
                </div>

                <p class="goal-progress-label">
                    ${completed
                        ? "You've reached your savings target!"
                        : goalCurrency.format(Math.max(0, goal.target - goal.saved)) + " left to reach your goal"
                    }
                </p>

                ${completed ? "" : `
                    <form class="goal-contribution" data-goal-id="${goal.id}">
                        <input
                            type="number"
                            name="contribution"
                            min="0.01"
                            step="0.01"
                            placeholder="Amount to add (₹)"
                            required
                        >

                        <button type="submit">
                            Add savings
                        </button>
                    </form>
                `}

                <button
                    type="button"
                    class="goal-delete"
                    data-action="delete"
                    data-goal-id="${goal.id}"
                >
                    Delete goal
                </button>

            </article>
        `;

    }).join("");
}


// Create a new goal

if (goalForm) {

    goalForm.addEventListener("submit", function(event) {

        event.preventDefault();

        const name = document.getElementById("goalName").value.trim();

        const target = Number(
            document.getElementById("goalTarget").value
        );

        if (!name || !Number.isFinite(target) || target <= 0) {
            alert("Please enter a valid goal name and target amount.");
            return;
        }

        const newGoal = {
            id: Date.now().toString(),
            name: name,
            target: target,
            saved: 0
        };

        savingsGoals.push(newGoal);

        saveGoals();
        renderGoals();

        goalForm.reset();

    });

}


// Add savings or delete a goal

if (goalsList) {

    goalsList.addEventListener("submit", function(event) {

        const form = event.target.closest(".goal-contribution");

        if (!form) return;

        event.preventDefault();

        const goalId = form.dataset.goalId;

        const amount = Number(
            form.elements.contribution.value
        );

        const goal = savingsGoals.find(
            item => item.id === goalId
        );

        if (!goal || !Number.isFinite(amount) || amount <= 0) {
            alert("Please enter a valid contribution.");
            return;
        }

        goal.saved = Math.min(
            goal.target,
            goal.saved + amount
        );

        saveGoals();
        renderGoals();

    });


    goalsList.addEventListener("click", function(event) {

        const deleteButton = event.target.closest(
            '[data-action="delete"]'
        );

        if (!deleteButton) return;

        const goalId = deleteButton.dataset.goalId;

        const confirmed = confirm(
            "Are you sure you want to delete this savings goal?"
        );

        if (!confirmed) return;

        savingsGoals = savingsGoals.filter(
            goal => goal.id !== goalId
        );

        saveGoals();
        renderGoals();

    });

}


// Display saved goals when the website opens

renderGoals();

// =====================================
// 8. MONTHLY EXPENSE CALENDAR
// =====================================

const calendarGrid = document.getElementById("calendarGrid");
const calendarMonth = document.getElementById("calendarMonth");
const calendarDetails = document.getElementById("calendarDetails");

let calendarDate = new Date();
let selectedCalendarDate = null;

// Convert date into YYYY-MM-DD format
function getCalendarDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// Display the calendar
function renderCalendar() {
    if (!calendarGrid || !calendarMonth) return;

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    calendarMonth.textContent = calendarDate.toLocaleDateString(
        "en-IN",
        { month: "long", year: "numeric" }
    );

    calendarGrid.innerHTML = "";

    // Empty spaces before the first day
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement("div");
        emptyCell.className = "calendar-day empty";
        calendarGrid.appendChild(emptyCell);
    }

    const todayKey = getCalendarDateKey(new Date());

    // Create each day
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateKey = getCalendarDateKey(date);

        const dailyExpenses = budget.expenses.filter(
            expense => expense.date === dateKey
        );

        const dailyTotal = dailyExpenses.reduce(
            (total, expense) => total + Number(expense.amount),
            0
        );

        const dayButton = document.createElement("button");
        dayButton.type = "button";
        dayButton.className = "calendar-day";

        if (dateKey === todayKey) {
            dayButton.classList.add("today");
        }

        if (dateKey === selectedCalendarDate) {
            dayButton.classList.add("selected");
        }

        dayButton.innerHTML = `
            <span class="day-number">${day}</span>
            ${
                dailyTotal > 0
                    ? `<span class="day-spending">${formatMoney(dailyTotal)}</span>`
                    : ""
            }
        `;

        dayButton.addEventListener("click", function () {
            selectedCalendarDate = dateKey;
            renderCalendar();
            showCalendarDetails(dateKey);
        });

        calendarGrid.appendChild(dayButton);
    }
}

// Show transactions for the selected date
function showCalendarDetails(dateKey) {
    if (!calendarDetails) return;

    const dailyExpenses = budget.expenses.filter(
        expense => expense.date === dateKey
    );

    const readableDate = new Date(
        Number(dateKey.slice(0, 4)),
        Number(dateKey.slice(5, 7)) - 1,
        Number(dateKey.slice(8, 10))
    ).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    if (dailyExpenses.length === 0) {
        calendarDetails.innerHTML = `
            <h3>${readableDate}</h3>
            <p class="empty-state">No expenses recorded on this day.</p>
        `;
        return;
    }

    const dailyTotal = dailyExpenses.reduce(
        (total, expense) => total + Number(expense.amount),
        0
    );

    calendarDetails.innerHTML = `
        <h3>${readableDate}</h3>
        <p class="goal-amount">
            Total spent: ${formatMoney(dailyTotal)}
        </p>

        <div class="item-list">
            ${dailyExpenses.map(expense => `
                <div class="list-item">
                    <div class="item-info">
                        <div class="item-name">
                            ${escapeHTML(expense.name)}
                        </div>
                        <div class="item-meta">
                            ${escapeHTML(expense.category)}
                        </div>
                    </div>

                    <span class="item-amount">
                        −${formatMoney(expense.amount)}
                    </span>
                </div>
            `).join("")}
        </div>
    `;
}

// Previous month
document.getElementById("prevMonth")?.addEventListener("click", function () {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    selectedCalendarDate = null;
    renderCalendar();

    calendarDetails.innerHTML = `
        <p class="empty-state">Select a date to see your transactions.</p>
    `;
});

// Next month
document.getElementById("nextMonth")?.addEventListener("click", function () {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    selectedCalendarDate = null;
    renderCalendar();

    calendarDetails.innerHTML = `
        <p class="empty-state">Select a date to see your transactions.</p>
    `;
});

// Initial display
renderCalendar();

async function startDashboard() {
    try {
        const user = await dashboardSessionReady;

        if (!user) return;

        // Load both datasets before showing anything.
        const [cloudBudget, cloudGoals] = await Promise.all([
            loadCloudBudget(user),
            loadCloudGoals(user)
        ]);

        budget = cloudBudget;
        savingsGoals = cloudGoals;

        renderDashboard();
        renderGoals();
        renderCalendar();

        document.getElementById("dashboardContent").hidden = false;

    } catch (error) {
        console.error("Dashboard loading failed:", error);

        alert(
            "Your financial data could not be loaded. " +
            "Please check your connection and refresh the page."
        );
    }
}

startDashboard();
