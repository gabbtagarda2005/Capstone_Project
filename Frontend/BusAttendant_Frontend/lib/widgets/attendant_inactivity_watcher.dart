import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// After [inactivityMinutes] without pointer, scroll, or keyboard input, calls [onInactiveTimeout].
/// Mirrors Admin portal “Session timeout (minutes of inactivity)” when [enabled] is true.
class AttendantInactivityWatcher extends StatefulWidget {
  const AttendantInactivityWatcher({
    super.key,
    required this.enabled,
    required this.inactivityMinutes,
    required this.onInactiveTimeout,
    required this.child,
  });

  final bool enabled;
  final int inactivityMinutes;
  final VoidCallback onInactiveTimeout;
  final Widget child;

  @override
  State<AttendantInactivityWatcher> createState() => _AttendantInactivityWatcherState();
}

class _AttendantInactivityWatcherState extends State<AttendantInactivityWatcher>
    with WidgetsBindingObserver {
  Timer? _timer;
  DateTime _lastActivity = DateTime.now();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _lastActivity = DateTime.now();
    _schedule();
    HardwareKeyboard.instance.addHandler(_onKey);
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_onKey);
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  bool _onKey(KeyEvent event) {
    if (event is KeyDownEvent) _bump();
    return false;
  }

  @override
  void didUpdateWidget(covariant AttendantInactivityWatcher oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.enabled != widget.enabled ||
        oldWidget.inactivityMinutes != widget.inactivityMinutes) {
      _lastActivity = DateTime.now();
      _schedule();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkAfterResume();
    }
  }

  void _checkAfterResume() {
    if (!widget.enabled) return;
    final m = widget.inactivityMinutes;
    if (m < 5 || m > 480) return;
    final limit = Duration(minutes: m);
    if (DateTime.now().difference(_lastActivity) >= limit) {
      widget.onInactiveTimeout();
    } else {
      _schedule();
    }
  }

  void _bump() {
    if (!widget.enabled) return;
    _lastActivity = DateTime.now();
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    if (!widget.enabled) return;
    final m = widget.inactivityMinutes;
    if (m < 5 || m > 480) return;
    final d = Duration(minutes: m);
    _timer = Timer(d, () {
      if (!mounted) return;
      if (DateTime.now().difference(_lastActivity) >= d) {
        widget.onInactiveTimeout();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: (ScrollNotification n) {
        if (n is ScrollStartNotification ||
            n is UserScrollNotification ||
            n is OverscrollNotification) {
          _bump();
        }
        return false;
      },
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => _bump(),
        onPointerSignal: (_) => _bump(),
        child: widget.child,
      ),
    );
  }
}
