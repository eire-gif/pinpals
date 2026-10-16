Pod::Spec.new do |s|
  s.name           = 'PinPalsAgeSignals'
  s.version        = '1.0.0'
  s.summary        = "Asks Apple's Declared Age Range for the member's age range (junior members, 0159)."
  s.description    = 'A thin bridge from JavaScript to AgeRangeService (iOS 26+). Every failure resolves to nil.'
  s.author         = 'PinPals'
  s.homepage       = 'https://www.pinpals.ie'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  # Weak: the framework only exists from iOS 26, and the app still runs on 15.1+.
  s.weak_frameworks = 'DeclaredAgeRange'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
