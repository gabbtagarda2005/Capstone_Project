import 'dart:async';

import 'package:flutter/material.dart';

import 'screens/login_screen.dart';
import 'screens/main_shell.dart';
import 'services/app_broadcast_controller.dart';
import 'services/maintenance_poller.dart';
import 'services/session_store.dart';
import 'services/theme_provider.dart';
import 'theme/app_colors.dart';
import 'theme/app_theme.dart';
import 'widgets/maintenance_overlay_host.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final themeProvider = ThemeProvider();
  await themeProvider.restore();
  runApp(BusAttendantApp(themeProvider: themeProvider));
}

class BusAttendantApp extends StatefulWidget {
  const BusAttendantApp({super.key, required this.themeProvider});

  final ThemeProvider themeProvider;

  @override
  State<BusAttendantApp> createState() => _BusAttendantAppState();
}

class _BusAttendantAppState extends State<BusAttendantApp> {
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.themeProvider,
      builder: (context, _) => MaterialApp(
        title: 'Bus Attendant',
        debugShowCheckedModeBanner: false,
        theme: buildLightAppTheme(),
        darkTheme: buildDarkAppTheme(),
        themeMode: widget.themeProvider.themeMode,
        builder: (context, child) => Stack(
          fit: StackFit.expand,
          children: [
            MaintenanceOverlayHost(child: child),
          ],
        ),
        home: _SessionGate(
          isDarkMode: widget.themeProvider.isDarkMode,
          onToggleDarkMode: () => widget.themeProvider.toggleThemeMode(),
        ),
      ),
    );
  }
}

class _SessionGate extends StatefulWidget {
  const _SessionGate({
    required this.isDarkMode,
    required this.onToggleDarkMode,
  });

  final bool isDarkMode;
  final VoidCallback onToggleDarkMode;

  @override
  State<_SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<_SessionGate> {
  final _session = SessionStore();
  bool _loading = true;
  String? _name;
  String? _token;
  Timer? _maintPoll;

  @override
  void initState() {
    super.initState();
    _restore();
    unawaited(MaintenancePoller.poll());
    unawaited(AppBroadcastController.instance.poll());
    _maintPoll = Timer.periodic(const Duration(seconds: 45), (_) {
      unawaited(MaintenancePoller.poll());
      unawaited(AppBroadcastController.instance.poll());
    });
  }

  @override
  void dispose() {
    _maintPoll?.cancel();
    super.dispose();
  }

  Future<void> _restore() async {
    final token = await _session.getToken();
    final name = await _session.getDisplayName();
    if (!mounted) return;
    setState(() {
      _token = token;
      _name = name;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: MintObsidian.mint)),
      );
    }
    if (_token != null && _token!.isNotEmpty && _name != null && _name!.isNotEmpty) {
      return MainShell(
        displayName: _name!,
        isDarkMode: widget.isDarkMode,
        onToggleDarkMode: widget.onToggleDarkMode,
      );
    }
    return LoginScreen(
      isDarkMode: widget.isDarkMode,
      onToggleDarkMode: widget.onToggleDarkMode,
    );
  }
}
