import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({
    super.key,
    required this.authToken,
    required this.onSignOut,
  });

  final String authToken;
  final VoidCallback onSignOut;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _api = ApiClient();
  late Future<ApiProfileMe> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.fetchProfile(token: widget.authToken);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: FutureBuilder<ApiProfileMe>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError || !snap.hasData) {
            return const Center(child: Text('Could not load profile'));
          }
          final p = snap.data!;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: AppColors.tealHeaderGradient,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 30,
                      backgroundColor: Color(0x33FFFFFF),
                      child: Icon(Icons.person_rounded, size: 34, color: AppColors.white),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${p.firstName} ${p.lastName}', style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w800, fontSize: 18)),
                          Text(p.role, style: TextStyle(color: AppColors.white.withValues(alpha: 0.9))),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _info('Email', p.email, Icons.mail_rounded),
              _info('Bus Number', p.busNumber, Icons.directions_bus_filled_rounded),
              _info('Phone', p.phone, Icons.call_rounded),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: widget.onSignOut,
                icon: const Icon(Icons.logout_rounded),
                label: const Text('Sign out'),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _info(String k, String v, IconData icon) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [BoxShadow(color: Color(0x12000000), blurRadius: 12, offset: Offset(0, 5))],
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.tealDeep),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(k, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                Text(v, style: const TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

