
const SUPABASE_URL = "https://kpgmhicedrnhuryfwvim.supabase.co";
const SUPABASE_KEY = "sb_publishable_-2rzuGEeeHVazLPaGZ4uAQ_BA3pikRp";

const dashboardSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

async function checkDashboardSession() {
    const { data, error } =
        await dashboardSupabase.auth.getUser();

    if (error || !data.user) {
        window.location.replace("login.html");
        return null;
    }

    return data.user;
}

async function logout() {
    const { error } =
        await dashboardSupabase.auth.signOut();

    if (error) {
        alert("Unable to log out. Please try again.");
        return;
    }

    window.location.replace("login.html");
}

document.getElementById("logoutButton")
    ?.addEventListener("click", logout);

const dashboardSessionReady = checkDashboardSession();
