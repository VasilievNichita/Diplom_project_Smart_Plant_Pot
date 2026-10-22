# Heater policy component

This release adds a standalone, host-tested decision component in `include/heater_policy.h`. It does not connect a heater, allocate a GPIO, or enable heating in an existing firmware profile. Integration and physical commissioning are separate steps.

The policy requires an observed physical OFF state before heating, a valid time-limited permission, RUN, fresh finite temperature and a dry tray. Targets must be finite and between 18 and 26 degrees Celsius. It applies 0.5 degree hysteresis and stops at 28 degrees. These are prototype bounds, not species-specific care recommendations.

Invalid conditions latch a fault. Renewing permission cannot clear it; the caller must explicitly acknowledge OFF. The integrating firmware is responsible for timestamps, freshness, polling frequency and actual output writes. This component alone provides no timing guarantee or independent electrical protection.

Run `scripts/test-native.ps1` with a host C++ compiler. It runs the existing core scenarios and `test/heater.cpp`. Tests cover startup, hysteresis, expired permission, stale/invalid temperature, invalid targets, RUN and tray conditions. Hardware tests have not been performed. A real heater needs a separately designed power circuit and independent thermal cutoff.
