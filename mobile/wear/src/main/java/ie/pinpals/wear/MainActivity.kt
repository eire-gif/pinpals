package ie.pinpals.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

// PinPals for Wear OS (Oct 2026). See claude/wear-os.md.
//
// Nothing to set up on the watch: opening a live round on the phone puts it
// here, and finishing it there takes it away.

class MainActivity : ComponentActivity() {
  private lateinit var location: WatchLocation
  private var resumed = false

  private val askLocation = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) updateLocation()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    RoundModel.init(this)
    location = WatchLocation(this)
    setContent { PinPalsWearApp() }

    lifecycleScope.launch { PhoneLink.catchUp(applicationContext) }
    // Start or stop the GPS as rounds come and go.
    lifecycleScope.launch {
      RoundModel.screen.collectLatest { updateLocation() }
    }
  }

  override fun onResume() {
    super.onResume()
    resumed = true
    updateLocation()
    RoundModel.flush()
  }

  override fun onPause() {
    super.onPause()
    resumed = false
    location.stop()
  }

  private var asked = false

  private fun updateLocation() {
    if (!resumed || !RoundModel.wantsLocation()) {
      location.stop()
      return
    }
    val allowed = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (allowed) {
      location.start()
    } else if (!asked) {
      asked = true
      askLocation.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }
  }
}
