import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:ui';

import '../config/app_branding.dart';
import '../services/api_client.dart';
import '../services/google_auth_service.dart';
import '../services/offline_credential_store.dart';
import '../services/session_store.dart';
import '../theme/app_colors.dart';
import '../widgets/attendant_account_recovery_dialog.dart';
import '../widgets/google_logo.dart';
import 'main_shell.dart';

/// "Continue with Google" button content — Google's own branding guidelines for the light
/// button variant (white background, `#1F1F1F` text, the real multicolor "G" mark).
class _GoogleButtonLabel extends StatelessWidget {
  const _GoogleButtonLabel();

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        GoogleLogo(size: 20),
        SizedBox(width: 12),
        Text(
          'Continue with Google',
          style: TextStyle(
            color: Color(0xFF1F1F1F),
            fontWeight: FontWeight.w600,
            fontSize: 15,
          ),
        ),
      ],
    );
  }
}

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
  final _googleAuth = GoogleAuthService();
  final _offlineCreds = OfflineCredentialStore();
  bool _busy = false;
  bool _googleBusy = false;
  String? _error;
  String _companyName = kAppCompanyName;

  @override
  void initState() {
    super.initState();
    unawaited(_loadCompanyName());
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Same source of truth as the admin/passenger apps: whatever the admin set under
  /// Settings → Company Profile. Falls back to the bundled default if unreachable — this
  /// screen must still render (and let attendants attempt to sign in) with no backend up yet.
  Future<void> _loadCompanyName() async {
    try {
      final info = await _api.fetchPublicCompanyInfo();
      final name = info.name.trim();
      if (!mounted || name.isEmpty) return;
      setState(() => _companyName = name);
    } catch (_) {
      // Keep the bundled default — no network/backend yet is a normal pre-login state.
    }
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
        // Cache a verifier for this login so the same email+password can sign back in with no
        // connection at all later (see OfflineCredentialStore) — never the password itself.
        unawaited(_offlineCreds.saveVerifiedLogin(
          email: email,
          password: pass,
          token: r.token!,
          displayName: r.displayName!,
          ticketingToken: r.ticketingToken,
        ));
        await _enterApp(token: r.token!, displayName: r.displayName!, ticketingToken: r.ticketingToken);
        return;
      }

      // Only fall back to an offline-cached login when the request never reached the server —
      // a real "invalid credentials" rejection from a reachable server must never be bypassed.
      if (r.isNetworkFailure) {
        final offline = await _offlineCreds.tryOfflineLogin(email: email, password: pass);
        if (!mounted) return;
        if (offline != null) {
          await _enterApp(
            token: offline.token,
            displayName: offline.displayName,
            ticketingToken: offline.ticketingToken,
            offline: true,
          );
          return;
        }
        final hasCached = await _offlineCreds.hasAnyCachedAccount();
        if (!mounted) return;
        setState(() {
          _busy = false;
          _error = hasCached
              ? 'No internet connection, and this email/password doesn\'t match the account saved on this device.'
              : 'No internet connection. Sign in online at least once on this device before offline sign-in works.';
        });
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

  Future<void> _enterApp({
    required String token,
    required String displayName,
    String? ticketingToken,
    bool offline = false,
  }) async {
    await _session.saveSession(token: token, displayName: displayName, ticketingToken: ticketingToken);
    if (!mounted) return;
    if (offline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Signed in offline — some features need a connection.'),
          duration: Duration(seconds: 4),
        ),
      );
    }
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => MainShell(
          displayName: displayName,
          isDarkMode: widget.isDarkMode,
          onToggleDarkMode: widget.onToggleDarkMode ?? () {},
        ),
      ),
    );
  }

  Future<void> _submitGoogle() async {
    setState(() {
      _error = null;
      _googleBusy = true;
    });

    final outcome = await _googleAuth.signIn();
    if (!mounted) return;

    switch (outcome.type) {
      case GoogleAuthOutcomeType.cancelled:
        // Not an error — the attendant closed the account picker. Just go back to idle.
        setState(() => _googleBusy = false);
        return;
      case GoogleAuthOutcomeType.accountSelectionFailed:
        setState(() {
          _googleBusy = false;
          _error = outcome.message ?? 'Could not open Google account selection.';
        });
        return;
      case GoogleAuthOutcomeType.firebaseFailed:
        setState(() {
          _googleBusy = false;
          _error = outcome.message ?? 'Google sign-in failed.';
        });
        return;
      case GoogleAuthOutcomeType.success:
        break;
    }

    try {
      final r = await _api.loginWithGoogle(idToken: outcome.idToken!);
      if (!mounted) return;
      if (r.ok && r.token != null && r.displayName != null) {
        await _enterApp(token: r.token!, displayName: r.displayName!, ticketingToken: r.ticketingToken);
        return;
      }
      // Backend rejected this Google account (not a registered/active attendant) — sign it back
      // out of the native Google session too, so a retry shows the account picker again instead
      // of silently re-trying the same rejected account.
      await _googleAuth.signOut();
      if (!mounted) return;
      setState(() {
        _googleBusy = false;
        _error = r.message ?? 'Google login failed';
      });
    } catch (e) {
      await _googleAuth.signOut();
      if (!mounted) return;
      setState(() {
        _googleBusy = false;
        _error = _api.mapRequestFailure('Google login', e);
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
                        color: Colors.black.withValues(alpha: 0.45),
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
                          color: Colors.white.withValues(alpha: 0.08),
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
                      color: AppColors.white.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(color: AppColors.white.withValues(alpha: 0.13)),
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
                                  color: AppColors.white.withValues(alpha: 0.12),
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
                                _companyName,
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
                            onPressed: (_busy || _googleBusy) ? null : _submit,
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
                        const SizedBox(height: 18),
                        Row(
                          children: [
                            Expanded(child: Divider(color: AppColors.white.withValues(alpha: 0.24))),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 10),
                              child: Text(
                                'or',
                                style: TextStyle(color: AppColors.white.withValues(alpha: 0.65), fontSize: 12),
                              ),
                            ),
                            Expanded(child: Divider(color: AppColors.white.withValues(alpha: 0.24))),
                          ],
                        ),
                        const SizedBox(height: 18),
                        Container(
                          width: double.infinity,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(24),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.18),
                                blurRadius: 10,
                                offset: const Offset(0, 3),
                              ),
                            ],
                          ),
                          child: Material(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(24),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(24),
                              onTap: (_busy || _googleBusy) ? null : _submitGoogle,
                              child: Ink(
                                height: 46,
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(24),
                                  border: Border.all(color: const Color(0xFFDADCE0)),
                                ),
                                child: Center(
                                  child: (_busy || _googleBusy)
                                      ? (_googleBusy
                                          ? const SizedBox(
                                              height: 20,
                                              width: 20,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Color(0xFF1F1F1F),
                                              ),
                                            )
                                          : const Opacity(
                                              opacity: 0.4,
                                              child: _GoogleButtonLabel(),
                                            ))
                                      : const _GoogleButtonLabel(),
                                ),
                              ),
                            ),
                          ),
                        ),
                        Align(
                          alignment: Alignment.center,
                          child: TextButton(
                            onPressed: (_busy || _googleBusy) ? null : _showForgotPasswordDialog,
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
                              style: TextStyle(color: AppColors.white.withValues(alpha: 0.92), fontWeight: FontWeight.w600),
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
