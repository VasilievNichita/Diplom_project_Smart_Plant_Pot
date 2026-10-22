# Moisture decision component

This small release contains only `site/server/irrigation-policy.mjs` and its isolated unit test. It does not enable automatic watering or alter the existing public server routes.

The pure function accepts three calibrated relative moisture values, validated low/high thresholds and an explicit active-cycle flag. It returns `wait`, `dose` or `satisfied`. Three low values start a cycle; an active cycle continues below the high threshold. Invalid values and thresholds return `wait`.

`dose` is a proposed decision, never authorization to operate a pump. An integrating controller must separately enforce sensor freshness, calibration identity, water/tray guards, command exclusivity, dose/runtime/daily limits, soak time, response checks and safe restart. Values are relative sensor indices, not volumetric water percentages or plant-specific recommendations.

Run `node --test site/tests/irrigation-policy.test.mjs`. No physical irrigation or trained-model accuracy is claimed by this test.
