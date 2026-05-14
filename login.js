document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. INITIALIZE OFFICIAL SUPABASE SDK ---
    const SUPABASE_URL = "https://lzsdkshxkpirurriafnm.supabase.co";
    const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6c2Rrc2h4a3BpcnVycmlhZm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MTQxMTMsImV4cCI6MjA5NDI5MDExM30.iL0JXhX-xlHThdgKJ69Dm7Xja-gywoE7X7aIV3ci0bs";
    
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const showSignupBtn = document.getElementById('showSignup');
    const showLoginBtn = document.getElementById('showLogin');
    const splitScreen = document.querySelector('.split-screen');

    // Text Elements
    const heroTitle = document.getElementById('heroTitle');
    const heroSubtitle = document.getElementById('heroSubtitle');

    // --- Toast Notification Function ---
    function showToast(message, type = 'success') {
        let container = document.getElementById('toast-container');
        const toast = document.createElement('div'); 
        toast.className = `toast ${type}`;
        const iconClass = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
        toast.innerHTML = `<i class="fa-solid ${iconClass} toast-icon"></i><span class="toast-message">${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { 
            toast.classList.remove('show'); 
            setTimeout(() => toast.remove(), 400); 
        }, 3500);
    }

    // Auto-redirect to dashboard if they are already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            window.location.href = 'dashboard.html';
        }
    });

    // --- UI Sliding Form Toggles ---
    showSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Trigger the Slide Animation
        splitScreen.classList.add('swapped');

        // Wait 400ms (exactly halfway through the 0.8s slide) to swap forms while hidden behind the banner
        setTimeout(() => {
            loginForm.classList.remove('active-form');
            loginForm.style.display = 'none';
            
            signupForm.style.display = 'flex';
            void signupForm.offsetWidth; // Force Reflow
            signupForm.classList.add('active-form');

            // Swap Banner Text
            heroTitle.innerHTML = "Join the<br>Future";
            heroSubtitle.innerHTML = "Create your account to start managing attendance effortlessly and securely.";
        }, 400); 
    });

    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Trigger the Slide Animation Backwards
        splitScreen.classList.remove('swapped');

        // Wait 400ms to swap forms while hidden
        setTimeout(() => {
            signupForm.classList.remove('active-form');
            signupForm.style.display = 'none';
            
            loginForm.style.display = 'flex';
            void loginForm.offsetWidth; // Force Reflow
            loginForm.classList.add('active-form');

            // Swap Banner Text back to default
            heroTitle.innerHTML = "Smart Attendance<br>Management";
            heroSubtitle.innerHTML = "Automate your classroom tracking with real-time analytics, RFID scanning, and AI insights.";
        }, 400);
    });

    // --- 2. SUPABASE LOGIN FUNCTION ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const btn = document.getElementById('loginBtn');
        
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Signing In...';
        btn.disabled = true;

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        btn.innerHTML = originalText;
        btn.disabled = false;

        if (error) {
            showToast(error.message, 'error');
        } else {
            showToast('Login successful! Redirecting...', 'success');
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        }
    });

    // --- 3. SUPABASE SIGNUP FUNCTION ---
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signupName').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        const btn = document.getElementById('signupBtn');
        
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Creating Account...';
        btn.disabled = true;

        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: { full_name: name }
            }
        });

        btn.innerHTML = originalText;
        btn.disabled = false;

        if (error) {
            showToast(error.message, 'error');
        } else {
            showToast('Account created! Sliding back to login...', 'success');
            
            // Auto-fill login and slide back
            document.getElementById('loginEmail').value = email;
            document.getElementById('loginPassword').value = '';
            setTimeout(() => { showLoginBtn.click(); }, 800); 
        }
    });
});