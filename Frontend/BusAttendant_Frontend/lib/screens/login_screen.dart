import 'package:flutter/material.dart';
import 'dart:ui';

import '../config/app_branding.dart';
import '../services/api_client.dart';
import '../services/session_store.dart';
import '../theme/app_colors.dart';
import '../widgets/attendant_account_recovery_dialog.dart';
import 'main_shell.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    this.isDarkMode = true,
    this.onToggleDarkMode,
  });

  final bool isDarkMode;
  final VoidCallback? onToggleDarkMode;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _api = ApiClient();
  final _session = SessionStore();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _busy = true;
    });
    final email = _email.text.trim();
    final pass = _password.text;
    if (email.isEmpty || pass.isEmpty) {
      setState(() {
        _busy = false;
        _error = 'Enter email and password';
      });
      return;
    }

    try {
      final r = await _api.login(email: email, password: pass);
      if (!mounted) return;
      if (r.ok && r.token != null && r.displayName != null) {
        await _session.saveSession(
          token: r.token!,
          displayName: r.displayName!,
          ticketingToken: r.ticketingToken,
        );
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => MainShell(
              displayName: r.displayName!,
              isDarkMode: widget.isDarkMode,
              onToggleDarkMode: widget.onToggleDarkMode ?? () {},
            ),
          ),
        );
        return;
      }
      setState(() {
        _busy = false;
        _error = r.message ?? 'Login failed';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _api.mapRequestFailure('Login', e);
      });
    }
  }

  Future<void> _showForgotPasswordDialog() async {
    await showAttendantAccountRecoveryDialog(context, _api);
  }

  Future<void> _showForgotEmailDialog() async {
    final personnelCtrl = TextEditingController();
    String? recoveredEmail;
    String? lookupError;
    bool lookingUp = false;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) {
          Future<void> runLookup() async {
            final pid = personnelCtrl.text.trim();
            if (!RegExp(r'^\d{6}$').hasMatch(pid)) {
              setModalState(() {
                recoveredEmail = null;
                lookupError = 'Personnel ID must be exactly 6 digits.';
              });
              return;
            }
            setModalState(() {
              lookingUp = true;
              lookupError = null;
            });
            final r = await _api.operatorForgotEmail(personnelId: pid);
            if (!ctx.mounted) return;
            setModalState(() {
              lookingUp = false;
              recoveredEmail = r.ok ? r.email : null;
              lookupError = r.ok ? null : (r.message ?? 'Email lookup failed.');
            });
            if (r.ok && r.email != null && r.email!.isNotEmpty) {
              _email.text = r.email!;
            }
          }

          return Dialog(
            backgroundColor: Colors.transparent,
            insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(22),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10.0, sigmaY: 10.0),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF011126), Color(0xFF1F5885)],
                    ),
                    borderRadius: BorderRadius.circular(22),
                    border: Border.all(color: const Color(0xFF1F5885), width: 1),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.45),
                        blurRadius: 24,
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Expanded(
                            child: Text(
                              'Forgot email?',
                              style: TextStyle(
                                color: AppColors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                            onPressed: () => Navigator.of(ctx).pop(),
                            icon: const Icon(Icons.close_rounded, color: Colors.white, size: 22),
                            tooltip: 'Close',
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Enter your assigned 6-digit Personnel ID to retrieve your registered sign-in email.',
                        style: TextStyle(color: Color(0xE6FFFFFF), height: 1.4, fontSize: 15),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Personnel ID (6-digit)',
                        style: TextStyle(
                          color: AppColors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFF1F5885)),
                        ),
                        child: TextField(
                          controller: personnelCtrl,
                          keyboardType: TextInputType.number,
                          maxLength: 6,
                          style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w600),
                          decoration: const InputDecoration(
                            hintText: 'e.g. 294879',
                            hintStyle: TextStyle(color: Color(0x99FFFFFF)),
                            counterText: '',
                            border: InputBorder.none,
                            contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                          ),
                          onSubmitted: (_) => runLookup(),
                        ),
                      ),
                      if (recoveredEmail != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          'Registered email: $recoveredEmail',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.white,
                            fontSize: 14,
                          ),
                        ),
                      ],
                      if (lookupError != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          lookupError!,
                          style: const TextStyle(color: Color(0xFFFFB4AB), fontSize: 13),
                        ),
                      ],
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: lookingUp ? null : runLookup,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF334155),
                            disabledBackgroundColor: const Color(0xFF334155),
                            shadowColor: Colors.transparent,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            minimumSize: const Size.fromHeight(48),
                          ),
                          child: Text(
                            lookingUp ? 'Checking…' : 'Find email',
                            style: const TextStyle(
                              color: Color(0xE6FFFFFF),
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
    personnelCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(
              "Designs/LoginBackgroundImage.jpg",
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                decoration: const BoxDecoration(gradient: AppColors.tealHeaderGradient),
              ),
            ),
          ),
          Positioned.fill(
            child: Container(color: const Color(0x99020B1D)),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
                    decoration: BoxDecoration(
                      color: AppColors.white.withOpacity(0.06),
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(color: AppColors.white.withOpacity(0.13)),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x45000000),
                          blurRadius: 24,
                          offset: Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Center(
                          child: Column(
                            children: [
                              Container(
                                width: 96,
                                height: 96,
                                decoration: BoxDecoration(
                                  color: AppColors.white.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                clipBehavior: Clip.antiAlias,
                                child: Image.asset(
                                  kCompanyLogoAsset,
                                  fit: BoxFit.contain,
                                  errorBuilder: (_, __, ___) => const Center(
                                    child: Icon(Icons.directions_bus_rounded, size: 48, color: AppColors.white),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 14),
                              Text(
                                kAppCompanyName,
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                      color: AppColors.white,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.4,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 28),
                        Text(
                          'Welcome!',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                color: AppColors.white,
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const SizedBox(height: 26),
                        TextField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          style: const TextStyle(color: AppColors.white),
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            hintText: 'you@example.com',
                          ),
                        ),
                        const SizedBox(height: 18),
                        TextField(
                          controller: _password,
                          obscureText: true,
                          style: const TextStyle(color: AppColors.white),
                          decoration: const InputDecoration(
                            labelText: 'Password',
                          ),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 14),
                          Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB), fontSize: 13)),
                        ],
                        const SizedBox(height: 26),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: _busy ? null : _submit,
                            style: ElevatedButton.styleFrom(
                              minimumSize: const Size.fromHeight(46),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                              backgroundColor: MintObsidian.mint,
                              foregroundColor: MintObsidian.textOnMint,
                            ),
                            child: _busy
                                ? const SizedBox(
                                    height: 22,
                                    width: 22,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white),
                                  )
                                : const Text('Log In'),
                          ),
                        ),
                        Align(
                          alignment: Alignment.center,
                          child: TextButton(
                            onPressed: _busy ? null : _showForgotPasswordDialog,
                            child: const Text(
                              'Forgot password?',
                              style: TextStyle(color: AppColors.white),
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Align(
                          alignment: Alignment.center,
                          child: TextButton(
                            onPressed: _showForgotEmailDialog,
                            child: Text(
                              'Forgot email?',
                              style: TextStyle(color: AppColors.white.withOpacity(0.92), fontWeight: FontWeight.w600),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
