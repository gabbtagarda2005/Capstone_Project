/// Admin Command Center Socket.io origin (same host as Admin_Backend, default port 4001).
/// On a physical device use `--dart-define=ADMIN_SOCKET_URL=http://192.168.x.x:4001`.
String adminSocketOrigin() {
  const fromEnv = String.fromEnvironment(
    'ADMIN_SOCKET_URL',
    defaultValue: '',
  );
  if (fromEnv.trim().isNotEmpty) {
    return fromEnv.trim().replaceAll(RegExp(r'/+$'), '');
  }
  return 'http://127.0.0.1:4001';
}
