import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({
    super.key,
    required this.authToken,
    required this.ticketingToken,
    required this.onSignOut,
    required this.isDarkMode,
    required this.onToggleDarkMode,
  });

  final String authToken;
  final String ticketingToken;
  final VoidCallback onSignOut;
  final bool isDarkMode;
  final VoidCallback onToggleDarkMode;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _api = ApiClient();
  late Future<ApiStaffProfileHud> _future;
  Timer? _poll;
  bool _pdfBusy = false;
  DateTime? _lastGeneratedAt;

  static const Color _kMint = Color(0xFF5EE396);
  /// Slightly deeper green on light surfaces (readability).
  static const Color _kMintOnLight = Color(0xFF059669);

  Color _accentGreen(bool isDark) => isDark ? _kMint : _kMintOnLight;

  BoxDecoration _profileCardDecoration(bool isDark) {
    if (isDark) {
      return BoxDecoration(
        color: const Color(0xFF1F2937),
        borderRadius: BorderRadius.circular(16),
      );
    }
    return BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      boxShadow: const [
        BoxShadow(
          blurRadius: 10,
          color: Colors.black12,
          offset: Offset(0, 4),
        ),
      ],
    );
  }

  Future<ApiStaffProfileHud> _loadHud() async {
    try {
      return await _api.fetchStaffProfileHud(
        attendantToken: widget.authToken,
        ticketingToken: widget.ticketingToken,
      );
    } catch (_) {
      final p = await _api.fetchProfile(token: widget.authToken);
      ApiCompanyInfo company;
      try {
        company = await _api.fetchPublicCompanyInfo();
      } catch (_) {
        company = const ApiCompanyInfo(
          name: 'Bukidnon Bus Company, Inc.',
          phone: '',
          email: '',
          address: '',
          logoUrl: '',
        );
      }
      return ApiStaffProfileHud(
        profile: p,
        company: company,
      );
    }
  }

  void _showProfileInfo(ApiProfileMe p) {
    final cs = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      backgroundColor: cs.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Profile Information',
                style: t.titleLarge!.copyWith(
                  fontWeight: FontWeight.w800,
                  color: cs.onSurface,
                ),
              ),
              const SizedBox(height: 12),
              _hudInfo('Name', '${p.firstName} ${p.lastName}', Icons.person_rounded),
              _hudInfo('Email', p.email, Icons.mail_rounded),
              _hudInfo('Bus Number', p.busNumber, Icons.directions_bus_filled_rounded),
              _hudInfo('Phone', p.phone, Icons.call_rounded),
              _hudInfo('Role', p.role, Icons.badge_rounded),
            ],
          ),
        );
      },
    );
  }

  void _refresh() {
    setState(() {
      _future = _loadHud();
    });
  }

  @override
  void initState() {
    super.initState();
    _future = _loadHud();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final onSurface = cs.onSurface;
    final onSurfaceVariant = cs.onSurfaceVariant;
    final accent = _accentGreen(isDark);

    return SafeArea(
      child: FutureBuilder<ApiStaffProfileHud>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator(color: MintObsidian.mint));
          }
          if (snap.hasError || !snap.hasData) {
            final err = snap.error?.toString().trim();
            final detail = (err == null || err.isEmpty) ? 'Check your session and API connection.' : err;
            return Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Could not load profile',
                      style: t.titleMedium!.copyWith(color: onSurfaceVariant),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      detail,
                      textAlign: TextAlign.center,
                      style: t.bodySmall!.copyWith(color: onSurfaceVariant),
                    ),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      alignment: WrapAlignment.center,
                      children: [
                        OutlinedButton.icon(
                          onPressed: _refresh,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('Retry'),
                        ),
                        TextButton.icon(
                          onPressed: widget.onSignOut,
                          icon: const Icon(Icons.logout_rounded),
                          label: const Text('Sign in again'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }
          final hud = snap.data!;
          final p = hud.profile;
          final c = hud.company;

          return ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            children: [
              Text(
                'Profile',
                style: t.headlineSmall!.copyWith(color: onSurface),
              ),
              const SizedBox(height: 14),
              _ProfileHeroHeader(
                profile: p,
                textTheme: t,
                colorScheme: cs,
                isDark: isDark,
              ),
              const SizedBox(height: 16),
              _ProfileCard(
                decoration: _profileCardDecoration(isDark),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'ORGANIZATION',
                      style: t.labelSmall!.copyWith(
                        color: onSurfaceVariant,
                        letterSpacing: 1.1,
                      ),
                    ),
                    const SizedBox(height: 12),
                    _organizationBody(c, t, onSurface, onSurfaceVariant, accent, isDark),
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: () => _showProfileInfo(p),
                      icon: Icon(Icons.badge_outlined, size: 20, color: accent),
                      label: Text(
                        'View staff profile details',
                        style: t.labelLarge!.copyWith(color: accent, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _ProfileCard(
                decoration: _profileCardDecoration(isDark),
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    widget.isDarkMode ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                    color: accent,
                    size: 26,
                  ),
                  title: Text(
                    'Appearance',
                    style: t.titleMedium!.copyWith(fontWeight: FontWeight.w700, color: onSurface),
                  ),
                  subtitle: Text(
                    widget.isDarkMode ? 'Dark mode' : 'Light mode',
                    style: t.bodySmall!.copyWith(color: onSurfaceVariant),
                  ),
                  trailing: Switch(
                    value: widget.isDarkMode,
                    onChanged: (_) => widget.onToggleDarkMode(),
                    activeThumbColor: Colors.white,
                    activeTrackColor: _kMint.withValues(alpha: 0.65),
                    inactiveThumbColor: onSurfaceVariant,
                    inactiveTrackColor: onSurfaceVariant.withValues(alpha: 0.28),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              _ProfileCard(
                decoration: _profileCardDecoration(isDark),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'ACTIONS',
                      style: t.labelSmall!.copyWith(
                        color: onSurfaceVariant,
                        letterSpacing: 1.1,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _shiftSummaryButton(t, onSurface, onSurfaceVariant, accent, isDark),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: widget.onSignOut,
                      icon: Icon(Icons.logout_rounded, color: onSurfaceVariant),
                      label: Text('Sign out', style: t.labelLarge!.copyWith(color: onSurface)),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        side: BorderSide(color: onSurfaceVariant.withValues(alpha: 0.35)),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
          );
        },
      ),
    );
  }

  Widget _organizationBody(
    ApiCompanyInfo c,
    TextTheme t,
    Color onSurface,
    Color onSurfaceVariant,
    Color accent,
    bool isDark,
  ) {
    final name = c.name.trim().isEmpty ? 'Bukidnon Bus Company, Inc.' : c.name.trim();
    final phone = c.phone.trim();
    final email = c.email.trim();
    final addr = c.address.trim();
    final logo = c.logoUrl.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _orgLogo(logo, accent),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                name,
                style: t.titleMedium!.copyWith(
                  fontWeight: FontWeight.w800,
                  color: onSurface,
                  height: 1.25,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        _contactLine(Icons.phone_rounded, 'Company phone', phone, t, onSurface, onSurfaceVariant, accent),
        _contactLine(Icons.email_rounded, 'Company email', email, t, onSurface, onSurfaceVariant, accent),
        _contactLine(Icons.location_on_outlined, 'Address', addr, t, onSurface, onSurfaceVariant, accent),
      ],
    );
  }

  Widget _orgLogo(String logo, Color accent) {
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accent.withValues(alpha: 0.35)),
      ),
      child: logo.startsWith('https://')
          ? ClipRRect(
              borderRadius: BorderRadius.circular(11),
              child: Image.network(
                logo,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Icon(Icons.directions_bus_filled_rounded, color: accent, size: 26),
              ),
            )
          : Icon(Icons.directions_bus_filled_rounded, color: accent, size: 26),
    );
  }

  Widget _contactLine(
    IconData icon,
    String label,
    String value,
    TextTheme t,
    Color onSurface,
    Color onSurfaceVariant,
    Color accent,
  ) {
    final display = value.isEmpty ? '—' : value;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: t.labelSmall!.copyWith(color: onSurfaceVariant, letterSpacing: 0.2),
                ),
                const SizedBox(height: 2),
                Text(
                  display,
                  style: t.bodyMedium!.copyWith(color: onSurface, fontWeight: FontWeight.w600, height: 1.3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _hudInfo(String k, String v, IconData icon) {
    final cs = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = _accentGreen(isDark);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(icon, color: accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  k,
                  style: t.labelMedium!.copyWith(color: cs.onSurfaceVariant),
                ),
                Text(
                  v.isEmpty ? '—' : v,
                  style: t.bodyMedium!.copyWith(
                    fontWeight: FontWeight.w700,
                    color: cs.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _shiftSummaryButton(
    TextTheme t,
    Color onSurface,
    Color onSurfaceVariant,
    Color accent,
    bool isDark,
  ) {
    final lastLabel = _lastGeneratedAt == null
        ? 'Last generated: —'
        : 'Last generated: ${_fmtYmdHm(_lastGeneratedAt!)}';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: _pdfBusy ? null : _onGenerateShiftSummary,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: accent.withValues(alpha: isDark ? 0.55 : 0.45),
              width: 1.2,
            ),
            color: accent.withValues(alpha: 0.08),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Icon(Icons.download_rounded, color: accent, size: 24),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Generate shift summary',
                        style: t.titleSmall!.copyWith(
                          color: onSurface,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        lastLabel,
                        style: t.bodySmall!.copyWith(color: onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                if (_pdfBusy)
                  SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2, color: accent),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _onGenerateShiftSummary() async {
    setState(() => _pdfBusy = true);
    try {
      final data = await _api.fetchShiftSummary(
        attendantToken: widget.authToken,
        ticketingToken: widget.ticketingToken,
      );
      final bytes = await _buildShiftPdf(data);
      final filename = 'shift-summary-${data.date.isEmpty ? 'today' : data.date}.pdf';
      await Share.shareXFiles(
        [XFile.fromData(bytes, mimeType: 'application/pdf', name: filename)],
        text: 'Shift Summary (${data.date})',
        subject: 'Bus Attendant Shift Summary',
      );
      if (!mounted) return;
      setState(() => _lastGeneratedAt = DateTime.now());
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Shift summary generated. Use share sheet to save or email.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not generate shift summary: $e')),
      );
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  Future<Uint8List> _buildShiftPdf(ApiShiftSummary s) async {
    final doc = pw.Document();
    doc.addPage(
      pw.MultiPage(
        margin: const pw.EdgeInsets.all(28),
        build: (_) => [
          pw.Container(
            padding: const pw.EdgeInsets.all(12),
            decoration: pw.BoxDecoration(
              gradient: const pw.LinearGradient(
                colors: [PdfColor.fromInt(0xFF011126), PdfColor.fromInt(0xFF1F5885)],
              ),
              borderRadius: pw.BorderRadius.circular(8),
            ),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  s.companyName.isEmpty ? 'Bukidnon Bus Company, Inc.' : s.companyName,
                  style: pw.TextStyle(color: PdfColor.fromInt(0xFFFFFFFF), fontSize: 16, fontWeight: pw.FontWeight.bold),
                ),
                pw.SizedBox(height: 4),
                pw.Text(
                  'SHIFT SUMMARY REPORT   |   DATE: ${s.date}   |   STAFF ID: ${s.staffId.isEmpty ? "—" : s.staffId}',
                  style: pw.TextStyle(color: PdfColor.fromInt(0xFFE2E8F0), fontSize: 10),
                ),
              ],
            ),
          ),
          pw.SizedBox(height: 14),
          _pdfSection('Staff Profile', [
            'Name: ${s.staffName}',
            'Bus Number: ${s.busNumber}',
            'Email: ${s.staffEmail.isEmpty ? "—" : s.staffEmail}',
          ]),
          _pdfSection('Trip Log', [
            'Start Time: ${s.startTime}',
            'End Time: ${s.endTime}',
            'Total Kilometers: ${s.kilometers.toStringAsFixed(2)} km',
          ]),
          _pdfSection('Revenue', [
            'Total Tickets Sold: ${s.ticketsSold}',
            'Total Cash Remittance: PHP ${s.cashRemittance.toStringAsFixed(2)}',
          ]),
          _pdfSection('Stops (Geofence Hits)', [
            'Don Carlos: ${s.donCarlosAt}',
            'Maramag: ${s.maramagAt}',
            'Malaybalay: ${s.malaybalayAt}',
          ]),
          _pdfSection('Hardware Health', [
            s.hardwareStatement.isEmpty ? 'Tracking source status unavailable.' : s.hardwareStatement,
          ]),
        ],
      ),
    );
    return doc.save();
  }

  pw.Widget _pdfSection(String title, List<String> lines) {
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 10),
      child: pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(10),
        decoration: pw.BoxDecoration(
          border: pw.Border.all(color: PdfColor.fromInt(0xFF1F5885), width: 0.8),
          borderRadius: pw.BorderRadius.circular(6),
          color: PdfColor.fromInt(0xFFF8FAFC),
        ),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              title.toUpperCase(),
              style: pw.TextStyle(fontSize: 10, color: PdfColor.fromInt(0xFF1E3A8A), fontWeight: pw.FontWeight.bold),
            ),
            pw.SizedBox(height: 6),
            ...lines.map(
              (line) => pw.Padding(
                padding: const pw.EdgeInsets.only(bottom: 3),
                child: pw.Text(line, style: const pw.TextStyle(fontSize: 10)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _fmtYmdHm(DateTime dt) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${dt.year}-${two(dt.month)}-${two(dt.day)} ${two(dt.hour)}:${two(dt.minute)}';
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.decoration, required this.child});

  final BoxDecoration decoration;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: decoration,
      child: child,
    );
  }
}

class _ProfileHeroHeader extends StatelessWidget {
  const _ProfileHeroHeader({
    required this.profile,
    required this.textTheme,
    required this.colorScheme,
    required this.isDark,
  });

  final ApiProfileMe profile;
  final TextTheme textTheme;
  final ColorScheme colorScheme;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final name = '${profile.firstName} ${profile.lastName}'.trim();
    final t = textTheme;
    final cs = colorScheme;

    if (isDark) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
        decoration: BoxDecoration(
          gradient: MintObsidian.heroGradient,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: MintObsidian.heroGlow.withValues(alpha: 0.28),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          children: [
            CircleAvatar(
              radius: 44,
              backgroundColor: Colors.white.withValues(alpha: 0.18),
              child: const Icon(Icons.person_rounded, size: 50, color: MintObsidian.heroForeground),
            ),
            const SizedBox(height: 14),
            Text(
              name.isEmpty ? 'Attendant' : name,
              textAlign: TextAlign.center,
              style: t.titleLarge!.copyWith(
                color: MintObsidian.heroForeground,
                fontWeight: FontWeight.w800,
                fontSize: 22,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              profile.role,
              textAlign: TextAlign.center,
              style: t.bodyMedium!.copyWith(
                color: MintObsidian.heroForeground.withValues(alpha: 0.9),
              ),
            ),
          ],
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                const Color(0xFFE0F2FE).withValues(alpha: 0.88),
                const Color(0xFFF1F5F9).withValues(alpha: 0.92),
                Colors.white.withValues(alpha: 0.78),
              ],
            ),
            border: Border.all(color: Colors.white.withValues(alpha: 0.75)),
          ),
          child: Column(
            children: [
              CircleAvatar(
                radius: 44,
                backgroundColor: cs.primary.withValues(alpha: 0.16),
                child: Icon(Icons.person_rounded, size: 50, color: cs.primary),
              ),
              const SizedBox(height: 14),
              Text(
                name.isEmpty ? 'Attendant' : name,
                textAlign: TextAlign.center,
                style: t.titleLarge!.copyWith(
                  color: cs.onSurface,
                  fontWeight: FontWeight.w800,
                  fontSize: 22,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                profile.role,
                textAlign: TextAlign.center,
                style: t.bodyMedium!.copyWith(
                  color: cs.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
