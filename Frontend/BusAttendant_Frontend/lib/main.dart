import 'package:flutter/material.dart';

import 'screens/login_screen.dart';
import 'screens/main_shell.dart';
import 'services/session_store.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BusAttendantApp());
}

class BusAttendantApp extends StatelessWidget {
  const BusAttendantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Bus Attendant',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const _SessionGate(),
    );
  }
}

class _SessionGate extends StatefulWidget {
  const _SessionGate();

  @override
  State<_SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<_SessionGate> {
  final _session = SessionStore();
  bool _loading = true;
  String? _name;
  String? _token;

  @override
  void initState() {
    super.initState();
    _restore();
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
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_token != null && _token!.isNotEmpty && _name != null && _name!.isNotEmpty) {
      return MainShell(displayName: _name!);
    }
    return const LoginScreen();
  }
}
