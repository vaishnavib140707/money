
// MIDNIGHT MONEY - AUTHENTICATION

// Replace these with your Supabase project values
const SUPABASE_URL = "https://kpgmhicedrnhuryfwvim.supabase.co";
const SUPABASE_KEY = "sb_publishable_-2rzuGEeeHVazLPaGZ4uAQ_BA3pikRp";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authSubmit = document.getElementById("authSubmit");
const switchAuth = document.getElementById("switchAuth");
const switchText = document.getElementById("switchText");
const authMessage = document.getElementById("authMessage");
const authForm = document.getElementById("authForm");
const passwordInput = document.getElementById("password");

let isSignup = false;

// SWITCH BETWEEN LOGIN AND SIGNUP
switchAuth.addEventListener("click", function () {
    isSignup = !isSignup;
    authMessage.textContent = "";
    authForm.reset();

    if (isSignup) {
        authTitle.textContent = "Create your account";
        authSubtitle.textContent = "Start managing your money smarter.";
        authSubmit.textContent = "Create account";
        switchText.textContent = "Already have an account?";
        switchAuth.textContent = "Sign in";
        passwordInput.autocomplete = "new-password";
    } else {
        authTitle.textContent = "Welcome back";
        authSubtitle.textContent = "Sign in to continue your financial journey.";
        authSubmit.textContent = "Sign in";
        switchText.textContent = "Don't have an account?";
        switchAuth.textContent = "Sign up";
        passwordInput.autocomplete = "current-password";
    }
});

// HANDLE LOGIN AND SIGNUP
authForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;

    authMessage.textContent = "";
    authSubmit.disabled = true;
    authSubmit.textContent = "Please wait...";

    try {
        if (isSignup) {
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password
            });

            if (error) throw error;

            if (data.session) {
                window.location.href = "index.html";
            } else {
                authMessage.style.color = "#8bb4ff";
                authMessage.textContent =
                    "Account created! Check your email to confirm your account.";
            }

        } else {
            const { data, error } =
                await supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password
                });

            if (error) throw error;

            if (data.session) {
                window.location.href = "index.html";
            }
        }

    } catch (error) {
        authMessage.style.color = "#ff9ca9";
        authMessage.textContent = error.message;
    } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = isSignup
            ? "Create account"
            : "Sign in";
    }
});
