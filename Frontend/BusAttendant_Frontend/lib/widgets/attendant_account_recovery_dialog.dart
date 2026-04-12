import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/api_client.dart';

const Color _kMidnight = Color(0xFF011126);
const Color _kSlideOcean = Color(0xFF1F5885);
const Color _kNeonCyan = Color(0xFF00FFFF);
const Color _kSlate = Color(0xFF334155);
const Color _kObsidian = Color(0xFF020817);
const Color _kText90 = Color(0xE6FFFFFF);

Future<void> showAttendantAccountRecoveryDialog(BuildContext context, ApiClient api) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogCtx) => _AttendantAccountRecoveryDialog(
      api: api,
      parentContext: context,
    ),
  );
}

class _AttendantAccountRecoveryDialog extends StatefulWidget {
  const _AttendantAccountRecoveryDialog({
    required this.api,
    required this.parentContext,
  });

  final ApiClient api;
  final BuildContext parentContext;

  @override
  State<_AttendantAccountRecoveryDialog> createState() => _AttendantAccountRecoveryDialogState();
}

class _AttendantAccountRecoveryDialogState extends State<_AttendantAccountRecoveryDialog> {
  final _email = TextEditingController();
  final _newPass = TextEditingController();
  final _confirmPass = TextEditingController();
  final _otpControllers = List.generate(6, (_) => TextEditingController());
  final _otpFocus = List.generate(6, (_) => FocusNode());

  int _step = 0;
  bool _busy = false;
  bool _hoverPrimary = false;
  bool _hoverUpdate = false;
  bool _otpFlashRed = false;
  int? _otpFocusIndex;
  bool _newPassFocused = false;
  bool _confirmFocused = false;
  bool _emailFocused = false;
  String? _error;
  String? _resetToken;
  String _emailSent = '';
  ApiRecoveryPreview? _preview;
  String? _devOtp;
  String? _hint;
  bool _simulatedEmail = false;
  int _resendSeconds = 0;
  Timer? _resendTimer;

  static const _mono = TextStyle(fontFamily: 'monospace', fontFamilyFallback: ['Consolas', 'monospace']);

  @override
  void initState() {
    super.initState();
    for (var i = 0; i < 6; i++) {
      _otpFocus[i].addListener(() {
        if (_otpFocus[i].hasFocus) setState(() => _otpFocusIndex = i);
      });
    }
    _newPass.addListener(() => setState(() {}));
    _confirmPass.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _email.dispose();
    _newPass.dispose();
    _confirmPass.dispose();
    for (final c in _otpControllers) {
      c.dispose();
    }
    for (final f in _otpFocus) {
      f.dispose();
    }
    super.dispose();
  }

  void _startResendCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 59);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      if (_resendSeconds <= 1) {
        t.cancel();
        setState(() => _resendSeconds = 0);
        return;
      }
      setState(() => _resendSeconds -= 1);
    });
  }

  String get _otpString => _otpControllers.map((c) => c.text).join();

  Future<void> _flashOtpBoxes() async {
    setState(() => _otpFlashRed = true);
    await Future<void>.delayed(const Duration(milliseconds: 520));
    if (mounted) setState(() => _otpFlashRed = false);
  }

  Future<void> _sendOtp() async {
    final em = _email.text.trim();
    if (em.isEmpty) {
      setState(() => _error = 'Enter your registered email');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final r = await widget.api.operatorForgotPasswordOtp(email: em);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!r.ok) {
      setState(() => _error = r.message ?? 'Request failed');
      return;
    }
    _emailSent = em;
    _preview = r.preview;
    _devOtp = r.devOtp;
    _hint = r.hint;
    _simulatedEmail = r.simulatedEmail;
    setState(() {
      _step = 1;
      _error = null;
    });
    _startResendCooldown();
    for (final c in _otpControllers) {
      c.clear();
    }
    if (mounted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _otpFocus[0].requestFocus();
      });
    }
    if (!widget.parentContext.mounted) return;
    ScaffoldMessenger.of(widget.parentContext).showSnackBar(
      SnackBar(
        content: const Text('Verification code sent to your registered contact.'),
        backgroundColor: _kSlideOcean,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _verifyOtp() async {
    final otp = _otpString;
    if (!RegExp(r'^\d{6}$').hasMatch(otp)) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final vr = await widget.api.operatorVerifyResetOtp(email: _emailSent, otp: otp);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!vr.ok || vr.resetToken == null) {
      await _flashOtpBoxes();
      setState(() => _error = vr.message ?? 'Verification failed');
      return;
    }
    _resetToken = vr.resetToken;
    setState(() {
      _step = 2;
      _error = null;
      _devOtp = null;
      _hint = null;
    });
    _newPass.clear();
    _confirmPass.clear();
  }

  Future<void> _submitNewPassword() async {
    final p1 = _newPass.text;
    final p2 = _confirmPass.text;
    if (p1.length < 8) {
      setState(() => _error = 'Password must be at least 8 characters');
      return;
    }
    if (p1 != p2) {
      setState(() => _error = 'Passwords do not match');
      return;
    }
    final tok = _resetToken;
    if (tok == null || tok.isEmpty) {
      setState(() => _error = 'Session expired. Start over.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final rr = await widget.api.operatorResetPasswordWithToken(
      token: tok,
      password: p1,
      confirmPassword: p2,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (!rr.ok) {
      setState(() => _error = rr.message ?? 'Reset failed');
      return;
    }
    Navigator.of(context).pop();
    await _showSuccessAndSnack();
  }

  Future<void> _showSuccessAndSnack() async {
    final pc = widget.parentContext;
    if (!pc.mounted) return;
    await showGeneralDialog<void>(
      context: pc,
      barrierDismissible: false,
      barrierColor: _kSlideOcean.withValues(alpha: 0.94),
      pageBuilder: (ctx, _, __) {
        return Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeOutCubic,
            builder: (_, t, __) => Opacity(
              opacity: t,
              child: Transform.scale(
                scale: 0.85 + 0.15 * t,
                child: Icon(Icons.verified_rounded, size: 96, color: Colors.white.withValues(alpha: 0.95)),
              ),
            ),
          ),
        );
      },
    );
    await Future<void>.delayed(const Duration(milliseconds: 850));
    if (pc.mounted) {
      Navigator.of(pc, rootNavigator: true).pop();
    }
    if (!pc.mounted) return;
    ScaffoldMessenger.of(pc).showSnackBar(
      const SnackBar(
        content: Text('Access Restored. Please Login'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  InputDecoration _oceanFieldDeco({
    required String hint,
    required bool focused,
    BorderSide? borderOverride,
  }) {
    final side = borderOverride ??
        BorderSide(
          color: focused ? _kNeonCyan : _kSlideOcean,
          width: focused ? 1.5 : 1,
        );
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.45)),
      filled: true,
      fillColor: Colors.white.withValues(alpha: 0.06),
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(4),
        borderSide: side,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(4),
        borderSide: borderOverride ?? const BorderSide(color: _kNeonCyan, width: 1.5),
      ),
    );
  }

  BorderSide _confirmBorder() {
    final c = _confirmPass.text;
    if (c.isNotEmpty && c != _newPass.text) {
      return const BorderSide(color: Color(0xFFEF4444), width: 1);
    }
    if (c.isNotEmpty && c == _newPass.text && _newPass.text.length >= 8) {
      return const BorderSide(color: _kNeonCyan, width: 1.5);
    }
    return BorderSide(color: _confirmFocused ? _kNeonCyan : _kSlideOcean, width: _confirmFocused ? 1.5 : 1);
  }

  BorderSide _newPassBorder() {
    final matchGlow = _confirmPass.text.isNotEmpty &&
        _confirmPass.text == _newPass.text &&
        _newPass.text.length >= 8;
    if (matchGlow) {
      return const BorderSide(color: _kNeonCyan, width: 1.5);
    }
    return BorderSide(color: _newPassFocused ? _kNeonCyan : _kSlideOcean, width: _newPassFocused ? 1.5 : 1);
  }

  Widget _slatePrimaryButton({
    required String label,
    required VoidCallback? onTap,
    bool loading = false,
  }) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hoverPrimary = true),
      onExit: (_) => setState(() => _hoverPrimary = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        decoration: BoxDecoration(
          color: _kSlate,
          borderRadius: BorderRadius.circular(8),
          boxShadow: _hoverPrimary && onTap != null
              ? [BoxShadow(color: _kNeonCyan.withValues(alpha: 0.35), blurRadius: 14, spreadRadius: 0)]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 14),
              child: Center(
                child: loading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: _kNeonCyan,
                        ),
                      )
                    : Text(
                        label,
                        style: GoogleFonts.plusJakartaSans(
                          fontWeight: FontWeight.w700,
                          color: _kText90,
                          fontSize: 15,
                        ),
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _obsidianUpdateButton({required VoidCallback? onTap, required bool loading}) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hoverUpdate = true),
      onExit: (_) => setState(() => _hoverUpdate = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        decoration: BoxDecoration(
          color: const Color(0xFF0A1628),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: _hoverUpdate ? _kNeonCyan : _kNeonCyan.withValues(alpha: 0.65),
            width: 1.5,
          ),
          boxShadow: _hoverUpdate
              ? [BoxShadow(color: _kNeonCyan.withValues(alpha: 0.25), blurRadius: 16)]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 15),
              child: Center(
                child: loading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: _kNeonCyan,
                        ),
                      )
                    : Text(
                        'Update Password',
                        style: GoogleFonts.plusJakartaSans(
                          fontWeight: FontWeight.w800,
                          color: _kText90,
                          fontSize: 15,
                        ),
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _strengthLed(String pwd) {
    final len = pwd.length;
    final lit = len.clamp(0, 8);
    Color tierColor;
    if (len == 0) {
      tierColor = Colors.white24;
    } else if (len <= 3) {
      tierColor = const Color(0xFFEF4444);
    } else if (len < 8) {
      tierColor = const Color(0xFFF59E0B);
    } else {
      tierColor = const Color(0xFF10B981);
    }
    return Row(
      children: List.generate(8, (i) {
        final on = i < lit;
        return Expanded(
          child: Container(
            margin: EdgeInsets.only(right: i < 7 ? 4 : 0),
            height: 9,
            decoration: BoxDecoration(
              color: on ? tierColor : Colors.white.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(2),
              boxShadow: on ? [BoxShadow(color: tierColor.withValues(alpha: 0.45), blurRadius: 5)] : null,
            ),
          ),
        );
      }),
    );
  }

  Widget _otpBox(int i) {
    final focused = _otpFocusIndex == i;
    BorderSide side;
    if (_otpFlashRed) {
      side = const BorderSide(color: Color(0xFFEF4444), width: 1.5);
    } else if (focused) {
      side = const BorderSide(color: _kNeonCyan, width: 1.5);
    } else {
      side = BorderSide(color: Colors.white.withValues(alpha: 0.22), width: 1);
    }
    return Container(
      width: 44,
      height: 52,
      margin: EdgeInsets.only(right: i < 5 ? 6 : 0),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        color: Colors.white.withValues(alpha: 0.08),
        border: Border.fromBorderSide(side),
        boxShadow: focused && !_otpFlashRed
            ? [BoxShadow(color: _kNeonCyan.withValues(alpha: 0.22), blurRadius: 8)]
            : null,
      ),
      alignment: Alignment.center,
      child: TextField(
        controller: _otpControllers[i],
        focusNode: _otpFocus[i],
        textAlign: TextAlign.center,
        keyboardType: TextInputType.number,
        maxLength: 1,
        style: GoogleFonts.jetBrainsMono(
          fontSize: 24,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
        cursorColor: _kNeonCyan,
        decoration: const InputDecoration(
          counterText: '',
          border: InputBorder.none,
          isDense: true,
          contentPadding: EdgeInsets.zero,
        ),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        onChanged: (v) {
          final d = v.replaceAll(RegExp(r'\D'), '');
          if (d.isEmpty) {
            _otpControllers[i].clear();
            if (i > 0) _otpFocus[i - 1].requestFocus();
            setState(() {});
            return;
          }
          final ch = d.substring(d.length - 1);
          _otpControllers[i].value = TextEditingValue(
            text: ch,
            selection: const TextSelection.collapsed(offset: 1),
          );
          if (i < 5) _otpFocus[i + 1].requestFocus();
          setState(() {});
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: _step == 0
            ? _buildStep0(context)
            : _step == 1
                ? _buildStep1(context)
                : _buildStep2(context),
      ),
    );
  }

  Widget _buildStep0(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [_kMidnight, _kSlideOcean],
        ),
        border: Border.all(color: _kSlideOcean, width: 1),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.45), blurRadius: 24)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'ACCOUNT RECOVERY',
            style: GoogleFonts.plusJakartaSans(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Enter your registered attendant email. We will send a 6-digit code to verify it is you.',
            style: GoogleFonts.plusJakartaSans(
              color: _kText90,
              height: 1.4,
              fontSize: 13.5,
            ),
          ),
          const SizedBox(height: 16),
          Focus(
            onFocusChange: (f) => setState(() => _emailFocused = f),
            child: TextField(
              controller: _email,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              style: const TextStyle(color: Colors.white),
              decoration: _oceanFieldDeco(
                hint: 'you@example.com',
                focused: _emailFocused,
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: GoogleFonts.plusJakartaSans(color: const Color(0xFFFFB4A8), fontSize: 13),
            ),
          ],
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              TextButton(
                onPressed: _busy ? null : () => Navigator.of(context).pop(),
                child: Text(
                  'Cancel',
                  style: GoogleFonts.plusJakartaSans(
                    color: _kNeonCyan.withValues(alpha: 0.85),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _slatePrimaryButton(
                  label: 'Request OTP',
                  loading: _busy,
                  onTap: _busy ? null : _sendOtp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStep1(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [_kObsidian, _kSlideOcean],
        ),
        border: Border.all(color: _kSlideOcean.withValues(alpha: 0.6), width: 1),
        boxShadow: [
          BoxShadow(color: _kSlideOcean.withValues(alpha: 0.12), blurRadius: 40, spreadRadius: -8),
          BoxShadow(color: Colors.black.withValues(alpha: 0.5), blurRadius: 24),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Icon(Icons.shield_outlined, size: 36, color: _kSlideOcean.withValues(alpha: 0.95)),
          ),
          const SizedBox(height: 10),
          Text(
            'VERIFY CODE',
            textAlign: TextAlign.center,
            style: GoogleFonts.plusJakartaSans(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 12),
          Text.rich(
            TextSpan(
              style: GoogleFonts.plusJakartaSans(color: _kText90, height: 1.45, fontSize: 13),
              children: [
                const TextSpan(text: "We've sent a 6-digit code to "),
                TextSpan(
                  text: _emailSent,
                  style: GoogleFonts.plusJakartaSans(
                    color: _kNeonCyan,
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
                const TextSpan(text: '.'),
              ],
            ),
            textAlign: TextAlign.center,
          ),
          if (_preview != null) ...[
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: Colors.white.withValues(alpha: 0.12),
                  backgroundImage: _preview!.avatarUrl != null ? NetworkImage(_preview!.avatarUrl!) : null,
                  onBackgroundImageError: _preview!.avatarUrl != null ? (_, __) {} : null,
                  child: _preview!.avatarUrl == null
                      ? Text(
                          _preview!.displayName.isNotEmpty ? _preview!.displayName[0].toUpperCase() : '?',
                          style: GoogleFonts.plusJakartaSans(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        )
                      : null,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _preview!.displayName,
                        style: GoogleFonts.plusJakartaSans(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'ID ${_preview!.staffId}',
                        style: _mono.copyWith(color: _kText90, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
          if (_simulatedEmail && (_devOtp != null || (_hint != null && _hint!.isNotEmpty))) ...[
            const SizedBox(height: 12),
            if (_hint != null)
              Text(
                _hint!,
                style: GoogleFonts.plusJakartaSans(color: _kText90, fontSize: 12, height: 1.35),
              ),
            if (_devOtp != null) ...[
              const SizedBox(height: 6),
              SelectableText(
                'Dev code: $_devOtp',
                style: _mono.copyWith(color: _kNeonCyan, fontWeight: FontWeight.w700, fontSize: 14),
              ),
            ],
          ],
          const SizedBox(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(6, _otpBox),
          ),
          const SizedBox(height: 8),
          Text(
            '${_otpString.length}/6',
            textAlign: TextAlign.right,
            style: _mono.copyWith(color: Colors.white.withValues(alpha: 0.65), fontSize: 11),
          ),
          const SizedBox(height: 8),
          Text(
            _resendSeconds > 0
                ? 'Resend code in ${(_resendSeconds ~/ 60).toString().padLeft(2, '0')}:${(_resendSeconds % 60).toString().padLeft(2, '0')}'
                : 'You can resend a new code.',
            textAlign: TextAlign.center,
            style: _mono.copyWith(color: _kText90, fontSize: 12),
          ),
          TextButton(
            onPressed: (_busy || _resendSeconds > 0) ? null : _sendOtp,
            child: Text(
              'Resend code',
              style: GoogleFonts.plusJakartaSans(
                color: (_busy || _resendSeconds > 0) ? Colors.white38 : _kNeonCyan,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (_error != null) ...[
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: GoogleFonts.plusJakartaSans(color: const Color(0xFFFFB4A8), fontSize: 13),
            ),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              TextButton(
                onPressed: _busy ? null : () => Navigator.of(context).pop(),
                child: Text('Cancel', style: GoogleFonts.plusJakartaSans(color: _kNeonCyan.withValues(alpha: 0.85))),
              ),
              TextButton(
                onPressed: _busy
                    ? null
                    : () {
                        setState(() {
                          _step = 0;
                          _error = null;
                          _resendTimer?.cancel();
                          _resendSeconds = 0;
                          for (final c in _otpControllers) {
                            c.clear();
                          }
                        });
                      },
                child: Text('Back', style: GoogleFonts.plusJakartaSans(color: _kNeonCyan.withValues(alpha: 0.85))),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: _slatePrimaryButton(
                  label: 'Verify & Proceed',
                  loading: _busy,
                  onTap: _busy ? null : _verifyOtp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStep2(BuildContext context) {
    final pwd = _newPass.text;
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [_kMidnight, _kSlideOcean],
        ),
        border: Border.all(color: _kSlideOcean, width: 1),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.45), blurRadius: 24)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'SECURE NEW ACCESS',
            style: GoogleFonts.plusJakartaSans(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Establish your new encrypted credentials',
            style: GoogleFonts.jetBrainsMono(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: _kNeonCyan.withValues(alpha: 0.9),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Minimum 8 characters',
            style: _mono.copyWith(color: _kText90.withValues(alpha: 0.85), fontSize: 11),
          ),
          const SizedBox(height: 8),
          _strengthLed(pwd),
          const SizedBox(height: 16),
          Focus(
            onFocusChange: (f) => setState(() => _newPassFocused = f),
            child: TextField(
              controller: _newPass,
              obscureText: true,
              enabled: !_busy,
              style: const TextStyle(color: Colors.white),
              decoration: _oceanFieldDeco(
                hint: 'New password',
                focused: _newPassFocused,
                borderOverride: _newPassBorder(),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Focus(
            onFocusChange: (f) => setState(() => _confirmFocused = f),
            child: TextField(
              controller: _confirmPass,
              obscureText: true,
              enabled: !_busy,
              style: const TextStyle(color: Colors.white),
              decoration: _oceanFieldDeco(
                hint: 'Confirm password',
                focused: _confirmFocused,
                borderOverride: _confirmBorder(),
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: GoogleFonts.plusJakartaSans(color: const Color(0xFFFFB4A8), fontSize: 13),
            ),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              TextButton(
                onPressed: _busy ? null : () => Navigator.of(context).pop(),
                child: Text('Cancel', style: GoogleFonts.plusJakartaSans(color: _kNeonCyan.withValues(alpha: 0.85))),
              ),
              TextButton(
                onPressed: _busy
                    ? null
                    : () {
                        setState(() {
                          _step = 1;
                          _error = null;
                          _resetToken = null;
                          _newPass.clear();
                          _confirmPass.clear();
                        });
                      },
                child: Text('Back', style: GoogleFonts.plusJakartaSans(color: _kNeonCyan.withValues(alpha: 0.85))),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: _obsidianUpdateButton(
                  loading: _busy,
                  onTap: _busy ? null : _submitNewPassword,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
