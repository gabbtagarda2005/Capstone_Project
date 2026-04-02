import 'package:flutter/material.dart';

import '../services/session_store.dart';
import '../theme/app_colors.dart';
import 'dashboard_page.dart';
import 'login_screen.dart';
import 'passenger_page.dart';
import 'profile_page.dart';
import 'ticketing_page.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key, required this.displayName});

  final String displayName;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  final _session = SessionStore();
  String? _token;
  bool _booting = true;

  @override
  void initState() {
    super.initState();
    _loadToken();
  }

  Future<void> _loadToken() async {
    final t = await _session.getToken();
    if (mounted) {
      setState(() {
        _token = t;
        _booting = false;
      });
    }
  }

  Future<void> _signOut() async {
    await _session.clear();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final token = _token ?? '';
    if (token.isEmpty) {
      return const LoginScreen();
    }

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: [
          DashboardPage(displayName: widget.displayName, authToken: token),
          TicketingPage(authToken: token),
          PassengerPage(authToken: token),
          ProfilePage(authToken: token, onSignOut: _signOut),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        indicatorColor: AppColors.tealTop.withOpacity(0.25),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Dashboard'),
          NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number_rounded),
            label: 'Ticketing',
          ),
          NavigationDestination(icon: Icon(Icons.groups_outlined), selectedIcon: Icon(Icons.groups_rounded), label: 'Passenger'),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings_rounded),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
