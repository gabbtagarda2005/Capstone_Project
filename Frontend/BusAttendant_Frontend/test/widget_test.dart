import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:bus_attendant_app/main.dart';
import 'package:bus_attendant_app/services/theme_provider.dart';

void main() {
  testWidgets('Bus attendant app builds', (WidgetTester tester) async {
    final themeProvider = ThemeProvider();
    await tester.pumpWidget(BusAttendantApp(themeProvider: themeProvider));
    await tester.pump();
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
