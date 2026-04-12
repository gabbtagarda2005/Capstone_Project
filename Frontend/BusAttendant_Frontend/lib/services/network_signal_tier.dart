import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Normalized for admin map + payloads: `strong` | `weak` | `offline`.
///
/// **Offline** is only when the OS reports no data link (`ConnectivityResult.none`).
/// We do **not** use DNS probes here: on many cellular networks DNS to arbitrary hosts
/// fails or is slow while HTTP to your API still works — probing used to block all uploads
/// and left the admin map frozen / “offline”.
///
/// - **Strong**: Wi‑Fi, Ethernet, or VPN.
/// - **Weak**: cellular / other — still uploads; admin may show amber “expect lag”.
Future<String> classifyNetworkSignalTier() async {
  if (kIsWeb) {
    return 'strong';
  }
  try {
    final list = await Connectivity().checkConnectivity();
    if (list.contains(ConnectivityResult.none)) {
      return 'offline';
    }
    if (list.contains(ConnectivityResult.wifi) ||
        list.contains(ConnectivityResult.ethernet) ||
        list.contains(ConnectivityResult.vpn)) {
      return 'strong';
    }
    if (list.contains(ConnectivityResult.mobile) || list.contains(ConnectivityResult.other)) {
      return 'weak';
    }
  } catch (_) {
    return 'weak';
  }
  return 'strong';
}
