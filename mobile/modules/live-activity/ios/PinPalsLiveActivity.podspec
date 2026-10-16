Pod::Spec.new do |s|
  s.name           = 'PinPalsLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts, updates and ends the PinPals lock screen scoring card.'
  s.description    = 'A thin bridge from JavaScript to PinPalsLiveActivityBridge, which lives in the app target (mobile/targets/widget/_shared).'
  s.author         = 'PinPals'
  s.homepage       = 'https://www.pinpals.ie'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
